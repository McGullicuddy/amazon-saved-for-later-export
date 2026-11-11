/* Build the bookmarklet and its install page.

   node scripts/build.mjs            writes dist/bookmarklet.txt and dist/index.html (+ style.css)
   node scripts/build.mjs --source   prints the stripped, readable source instead
   node scripts/build.mjs --url      prints the javascript: URL instead

   src/bookmarklet.js is written to be read: long, commented, indented. A bookmark URL wants
   it small, so the build drops comments, indentation and blank lines, then percent-encodes
   the rest with encodeURIComponent.

   Comments are removed line by line, not by parsing JavaScript, which is only safe because
   of one rule the source follows: every comment is a whole-line block. Its opener comes first
   on its line, and its closer comes last on its line. Anything else (a trailing comment after
   code, a comment opener inside a string) would be cut wrongly, so the build refuses to finish
   if either marker survives, rather than shipping a broken bookmark. The test runs the built
   output, not the source, so a stripping mistake fails the test too.

   The install page is site/index.html with its {{PLACEHOLDERS}} filled in. Nothing is fetched
   at build time, and the page loads no scripts.

   Verifiability: the page names the commit it was built from and the SHA-256 of
   bookmarklet.txt. The build is deterministic (no timestamps, no randomness), so running it
   at that commit reproduces the same file and checksum. In CI the commit comes from
   GITHUB_SHA. Locally it is `git rev-parse HEAD`, which ignores uncommitted edits, but only
   CI's build is ever published. */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OPEN = '/*';
const CLOSE = '*/';

export class BuildError extends Error {}

/* Remove whole-line comment blocks, indentation and blank lines (see the header). */
export function stripSource(text) {
  const kept = [];
  let inComment = false;
  let startLine = 0;
  text.split(/\r?\n/).forEach((raw, index) => {
    const number = index + 1;
    const line = raw.trim();
    if (!inComment && line.startsWith(OPEN)) {
      inComment = true;
      startLine = number;
    }
    if (inComment) {
      /* A one-line block must be at least as long as its two markers, so "/*" alone does not
         count as opened and closed on the same line. */
      if (line.endsWith(CLOSE) && (number !== startLine || line.length >= OPEN.length + CLOSE.length)) {
        inComment = false;
      }
      return;
    }
    if (line) kept.push(line);
  });
  if (inComment) {
    throw new BuildError(`unterminated comment block starting at line ${startLine}`);
  }
  const result = kept.join('\n');
  for (const marker of [OPEN, CLOSE]) {
    if (result.includes(marker)) {
      throw new BuildError(`comment marker ${marker} remains after stripping; comments must be ` +
        'whole-line blocks (opener first on its line, closer last on its line)');
    }
  }
  return result;
}

export function buildBookmarklet(text) {
  const source = stripSource(text);
  return { source, url: 'javascript:' + encodeURIComponent(source) };
}

/* encodeURIComponent leaves no quote, angle bracket or ampersand in the URL, but the page must
   not depend on that, so the attribute is escaped anyway. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* The exact bytes of dist/bookmarklet.txt. The page's checksum is computed from this same
   function, so the two can't drift apart. */
export function bookmarkletFile(url) {
  return url + '\n';
}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const COMMIT_SHA = /^[0-9a-f]{40}$/;

export function renderInstallPage(template, { url, version, repoUrl, commit }) {
  let filled = template
    .replaceAll('{{BOOKMARKLET_HREF}}', escapeHtml(url))
    .replaceAll('{{VERSION}}', escapeHtml(version))
    .replaceAll('{{SIZE_KB}}', escapeHtml((url.length / 1024).toFixed(1)))
    .replaceAll('{{CHECKSUM}}', sha256Hex(bookmarkletFile(url)));
  if (repoUrl) {
    filled = filled.replaceAll('{{REPO_URL}}', escapeHtml(repoUrl));
  }
  if (commit !== undefined) {
    if (!COMMIT_SHA.test(commit)) {
      throw new BuildError(`not a full git commit SHA: ${JSON.stringify(commit)}`);
    }
    filled = filled.replaceAll('{{COMMIT}}', commit).replaceAll('{{COMMIT_SHORT}}', commit.slice(0, 7));
  }
  if (/\{\{[A-Z_]+\}\}/.test(filled)) {
    throw new BuildError('site/index.html has a placeholder the build does not fill');
  }
  return filled;
}

/* The commit being built: GitHub Actions' GITHUB_SHA, or else the checkout's HEAD. */
function currentCommit() {
  const fromCi = process.env.GITHUB_SHA || '';
  if (COMMIT_SHA.test(fromCi)) { return fromCi; }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    throw new BuildError('cannot tell which commit is being built: run inside the git checkout');
  }
}

function main(argv) {
  const text = readFileSync(join(ROOT, 'src', 'bookmarklet.js'), 'utf8');
  const { source, url } = buildBookmarklet(text);
  if (argv.includes('--source')) {
    process.stdout.write(source + '\n');
    return;
  }
  if (argv.includes('--url')) {
    process.stdout.write(url + '\n');
    return;
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  /* package.json's repository URL, as GitHub shows it: "git+https://…/x.git" -> "https://…/x". */
  const repoUrl = String((pkg.repository && pkg.repository.url) || '')
    .replace(/^git\+/, '')
    .replace(/\.git$/, '');
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repoUrl)) {
    throw new BuildError('package.json needs repository.url set to the GitHub repository');
  }
  const commit = currentCommit();
  const dist = join(ROOT, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'bookmarklet.txt'), bookmarkletFile(url));
  const template = readFileSync(join(ROOT, 'site', 'index.html'), 'utf8');
  writeFileSync(join(dist, 'index.html'),
    renderInstallPage(template, { url, version: pkg.version, repoUrl, commit }));
  copyFileSync(join(ROOT, 'site', 'style.css'), join(dist, 'style.css'));
  process.stdout.write(`built dist/ (bookmarklet ${url.length} characters)\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof BuildError)) throw error;
    process.stderr.write(`build: ${error.message}\n`);
    process.exit(1);
  }
}
