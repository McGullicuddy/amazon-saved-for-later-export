# Security policy

## Reporting a problem

Please report security problems **privately**, not in a public issue. Use
[Report a vulnerability](https://github.com/McGullicuddy/amazon-saved-for-later-export/security/advisories/new)
on this repository's Security tab.

Include:
- what's wrong, and what someone could do with it;
- how to reproduce it, ideally against the made-up cart page in `test/fixture-cart.html`;
- your browser and version.

**Don't include anything from your own Amazon account.** That means your cart, product names,
cookies, page source, screenshots or exported files. None of it is needed to describe a bug.

## What counts

- The bookmarklet sending data anywhere, doing anything to your Amazon account, or running
  somewhere other than an Amazon store.
- Content on Amazon's page making the bookmarklet do something it shouldn't.
- The install page serving something other than what `src/bookmarklet.js` builds to.
- A way to change what gets published without write access to this repository.

Bugs in what gets exported (missing items, wrong prices) are ordinary issues. Please report them
with the issue form.

## Versions

Only the current version, the one on the install page, gets fixes. An installed bookmark is a
copy that never updates itself. If a fix matters for safety, the advisory will say so, and
you'll need to reinstall from the install page to get it.

## Response

This is a personal project maintained on a best-effort basis. Reports are read and taken
seriously, but there's no guaranteed response time.
