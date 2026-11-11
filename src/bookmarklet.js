(function () {
  /* Bookmarklet: reads the "Saved for Later" items on a logged-in Amazon cart page and
     offers them as a downloaded JSON file (format "amazon-saved-for-later", version 2; see
     FORMAT.md). It talks to nothing: no network request, no cookie or storage access. What
     happens to the file afterwards is up to whoever downloaded it.

     COMMENT RULE: comments are whole-line blocks only (the slash-star opens the line, the
     star-slash closes it). scripts/build.mjs strips exactly those and fails if any comment
     marker survives, so a trailing comment after code breaks the build. */
  var OVERLAY_ID = 'saved-for-later-export-overlay';
  var CART_PATH = '/gp/cart/view.html';
  var MAX_IMAGES = 12;
  var MAX_URL = 1000;
  var ANCESTOR_CLIMB = 4;
  var ROUND_MS = 1200;
  var STABLE_ROUNDS = 3;
  var MAX_LOAD_MS = 60000;

  /* Only ever run on an Amazon storefront: the page's own session is what makes the cart
     readable, and we must not scrape from any other site. The check is an exact list of
     storefront hostnames (optional www. or smile. prefix), anchored at both ends, so a
     lookalike such as amazon.com.evil.example is refused. */
  var STORE_HOST = /^(www\.|smile\.)?amazon\.(com|ca|com\.mx|com\.br|co\.uk|de|fr|it|es|nl|se|pl|com\.be|com\.tr|ae|sa|eg|in|co\.jp|com\.au|sg|ie)$/;
  if (!STORE_HOST.test(location.hostname)) {
    alert('Saved for Later export: open your Amazon cart page first, then click it.');
    return;
  }
  /* Guard against running twice at once (a second click would stack overlays/loops). */
  if (document.getElementById(OVERLAY_ID)) {
    return;
  }

  /* ---------- Finding items ----------
     FRAGILE PART: these selectors are a best guess at Amazon's cart markup as of 2026.
     Amazon changes it without notice; if the bookmarklet reports zero items on a cart
     that clearly has saved items, start here. Tried in order, first non-empty wins. */
  var ITEM_SELECTORS = [
    '[data-itemtype="saved"][data-asin]',
    '#sc-saved-cart [data-asin]',
    '#sc-secondary-list [data-asin]'
  ];
  var CONTAINER_SELECTORS = ['#sc-saved-cart', '#sc-secondary-list'];

  function findItems() {
    for (var i = 0; i < ITEM_SELECTORS.length; i++) {
      var matched = Array.prototype.filter.call(
        document.querySelectorAll(ITEM_SELECTORS[i]),
        function (el) { return (el.getAttribute('data-asin') || '').trim() !== ''; }
      );
      /* Drop items nested inside another matched item (e.g. a recommendation widget
         carrying its own data-asin) so they are not counted as saved items. */
      matched = matched.filter(function (el) {
        return !matched.some(function (other) { return other !== el && other.contains(el); });
      });
      if (matched.length) { return matched; }
    }
    return [];
  }

  function findContainer() {
    for (var i = 0; i < CONTAINER_SELECTORS.length; i++) {
      var el = document.querySelector(CONTAINER_SELECTORS[i]);
      if (el) { return el; }
    }
    return null;
  }

  /* Click ONE "load more" control, if present. Deliberately strict: the whole trimmed
     text must be "See/Show/Load more [items]". Amazon also has "See more like this"
     links inside items that navigate away; those must never be clicked, hence the
     exact-match regex and the "not inside any item" rule. */
  var LOAD_MORE = /^(see|show|load) more( items)?$/i;
  function clickLoadMore(items) {
    /* Without the Saved for Later container there is no telling which "See more" belongs
       to it (the cart page has others, in recommendation carousels), so fall back to
       scrolling alone rather than click something that might navigate away. */
    var root = findContainer();
    if (!root) { return false; }
    var candidates = root.querySelectorAll('a, button, input[type="submit"], input[type="button"]');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var label = (el.tagName === 'INPUT' ? el.value : el.textContent) || '';
      if (!LOAD_MORE.test(label.trim())) { continue; }
      if (el.closest('[data-asin]')) { continue; }
      if (items.some(function (item) { return item.contains(el); })) { continue; }
      if (leavesPage(el)) { continue; }
      el.click();
      return true;
    }
    return false;
  }

  /* A link to another page is never the control we want: following it would unload the
     cart and end the run. Only http(s) links whose address differs from this page in more
     than the #fragment count. Links with no href, a "#" href, or a javascript: href only
     run the page's own script, which is how a "load more" control works. */
  function leavesPage(el) {
    if (el.tagName !== 'A' || !el.hasAttribute('href')) { return false; }
    var target = String(el.href || '');
    if (!/^https?:/i.test(target)) { return false; }
    return target.split('#')[0] !== location.href.split('#')[0];
  }

  /* ---------- Extracting fields ---------- */
  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function firstText(item, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = item.querySelector(selectors[i]);
      var text = el ? clean(el.textContent) : '';
      if (text) { return text; }
    }
    return '';
  }

  function extractTitle(item) {
    var title = firstText(item, [
      '.sc-product-title .a-truncate-full',
      '.sc-product-title',
      '.a-truncate-full',
      'a[href*="/dp/"]',
      'a[href*="/gp/product/"]'
    ]);
    if (!title) {
      var img = item.querySelector('img');
      title = img ? clean(img.getAttribute('alt')) : '';
    }
    return title;
  }

  /* The price is exported twice. `price` is the text the page shows, so the currency
     comes from the page and is never guessed. `priceValue` is the numeric data-price, kept
     because it is handy for sorting and is otherwise lost. */
  var BARE_PRICE = /^[^\d]{0,4}\d[\d.,\s]*[^\d]{0,4}$/;
  var PRICE_SELECTORS = ['.sc-product-price', '.a-price .a-offscreen', '.sc-price'];

  /* Zero is what an unavailable item can carry, not a price, so it counts as none. */
  function extractPriceValue(item) {
    var attr = (item.getAttribute('data-price') || '').trim();
    if (attr !== '' && isFinite(Number(attr)) && Number(attr) > 0) { return Number(attr); }
    return null;
  }

  function extractPrice(item) {
    /* Only text that is a bare price counts ("$19.99", "19,99 €", "EUR 19,99"); text with
       words around it ("Price: $19.99") is not trusted as a price. */
    for (var i = 0; i < PRICE_SELECTORS.length; i++) {
      var el = item.querySelector(PRICE_SELECTORS[i]);
      var text = el ? clean(el.textContent) : '';
      if (BARE_PRICE.test(text)) { return text; }
    }
    var value = extractPriceValue(item);
    if (value === null) { return null; }
    /* A dollar sign is only added on the US storefront; elsewhere the currency is unknown
       here, so the number is given without a symbol. */
    return (/^(www\.)?amazon\.com$/.test(location.hostname) ? '$' : '') + value.toFixed(2);
  }

  /* Largest candidate of a srcset ("url 1x, url 2x" or "url 320w, url 640w"). Matching
     "url descriptor" pairs rather than splitting on commas, because Amazon image names
     can themselves contain commas. */
  function largestFromSrcset(srcset) {
    var best = '', bestSize = -1, re = /(\S+)\s+([\d.]+)[wx]/g, m;
    while ((m = re.exec(srcset || '')) !== null) {
      /* A srcset written without a space after its commas glues the comma onto the
         next URL; strip it. */
      if (parseFloat(m[2]) > bestSize) { bestSize = parseFloat(m[2]); best = m[1].replace(/^,+/, ''); }
    }
    return best;
  }

  /* ---------- Picture candidates ----------
     Raw URLs only: no host filtering and no size rewriting here, whoever reads the file
     decides which ones to trust and fetch. Hence only the scheme, the length and the count are checked. */
  function srcsetUrlsLargestFirst(srcset) {
    var pairs = [], re = /(\S+)\s+([\d.]+)[wx]/g, m;
    while ((m = re.exec(srcset || '')) !== null) {
      /* A srcset written without a space after its commas glues the comma onto the
         next URL; strip it. */
      pairs.push({ url: m[1].replace(/^,+/, ''), size: parseFloat(m[2]), order: pairs.length });
    }
    pairs.sort(function (a, b) { return b.size - a.size || a.order - b.order; });
    return pairs.map(function (pair) { return pair.url; });
  }

  /* Where to look for an item's pictures: the item itself if it holds an <img>. Otherwise
     climb at most ANCESTOR_CLIMB ancestors and take the first one with an <img>. An
     ancestor that also holds another matched item is refused and ends the climb, because
     every higher ancestor holds that neighbour too and its picture is not ours. */
  function pictureScope(item, allItems) {
    if (item.querySelector('img')) { return item; }
    var node = item.parentElement;
    for (var i = 0; i < ANCESTOR_CLIMB && node; i++) {
      var holdsNeighbour = allItems.some(function (other) {
        return other !== item && node.contains(other);
      });
      if (holdsNeighbour) { return null; }
      if (node.querySelector('img')) { return node; }
      node = node.parentElement;
    }
    return null;
  }

  function imageCandidates(item, allItems) {
    var scope = pictureScope(item, allItems);
    if (!scope) { return []; }
    var imgs = Array.prototype.slice.call(scope.querySelectorAll('img'));
    /* Amazon's main product picture carries sc-product-image; badges and icons do not.
       Those first, everything else after, each group in document order. */
    var primary = imgs.filter(function (img) { return img.classList.contains('sc-product-image'); });
    var rest = imgs.filter(function (img) { return !img.classList.contains('sc-product-image'); });
    var out = [], seen = {};
    function add(url) {
      url = clean(url);
      if (!/^https?:\/\//i.test(url) || url.length > MAX_URL || seen[url]) { return; }
      if (out.length >= MAX_IMAGES) { return; }
      seen[url] = true;
      out.push(url);
    }
    primary.concat(rest).forEach(function (img) {
      add(img.getAttribute('data-a-hires'));
      srcsetUrlsLargestFirst(img.getAttribute('srcset')).forEach(add);
      add(img.getAttribute('data-old-hires'));
      add(img.getAttribute('data-src'));
      /* currentSrc and src are read as properties so that a data: placeholder is seen and
         rejected by the scheme check in add(), same as any other non-http(s) value. */
      add(img.currentSrc);
      add(img.getAttribute('src'));
    });
    return out;
  }

  function extractAll(elements) {
    var seen = {}, out = [];
    elements.forEach(function (el) {
      var asin = (el.getAttribute('data-asin') || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin) || seen[asin]) { return; }
      seen[asin] = true;
      out.push({
        asin: asin,
        title: extractTitle(el),
        price: extractPrice(el),
        priceValue: extractPriceValue(el),
        images: imageCandidates(el, elements)
      });
    });
    return out;
  }

  /* ---------- Export file ---------- */
  function buildExport(items) {
    return {
      format: 'amazon-saved-for-later',
      version: 2,
      exportedAt: new Date().toISOString(),
      store: location.hostname,
      items: items
    };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fileName() {
    var d = new Date();
    return 'amazon-saved-for-later-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' +
      pad2(d.getDate()) + '.json';
  }

  /* Blob plus a temporary <a download>: works from a bookmarklet without any network and
     without a data: URL size limit. Must run inside the button's click handler so the
     browser treats it as a user-initiated download. */
  function downloadExport(items) {
    var name = fileName();
    var blob = new Blob([JSON.stringify(buildExport(items), null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* Revoke late: some browsers start reading the blob asynchronously after click(). */
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    return name;
  }

  /* ---------- Overlay ----------
     Product titles are third-party text: the overlay is built ONLY with createElement
     and textContent, never innerHTML. */
  var overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Saved for Later export');
  overlay.style.cssText = 'position:fixed;top:16px;right:16px;width:320px;box-sizing:border-box;' +
    'z-index:2147483647;background:#1d2330;color:#f2f4f8;padding:14px 16px;border-radius:10px;' +
    'font:14px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45);';
  document.body.appendChild(overlay);

  var cancelled = false;
  function closeOverlay() {
    cancelled = true;
    if (overlay.parentNode) { overlay.parentNode.removeChild(overlay); }
  }

  function addText(text) {
    var p = document.createElement('p');
    p.style.cssText = 'margin:0 0 10px;';
    p.textContent = text;
    overlay.appendChild(p);
    return p;
  }

  function addButton(label, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'font:inherit;padding:6px 12px;margin-left:8px;border-radius:6px;' +
      'border:1px solid #8892a6;background:transparent;color:#f2f4f8;cursor:pointer;';
    b.addEventListener('click', onClick);
    return b;
  }

  function render(message, builder) {
    while (overlay.firstChild) { overlay.removeChild(overlay.firstChild); }
    addText(message);
    var row = document.createElement('div');
    row.style.cssText = 'text-align:right;';
    if (builder) { builder(row); }
    overlay.appendChild(row);
  }

  function showProgress(count) {
    render('Loading Saved for Later… ' + count + ' items', function (row) {
      row.appendChild(addButton('Cancel', closeOverlay));
    });
  }

  function showZero() {
    render('No Saved for Later items found. Open your cart page (' + location.origin + CART_PATH +
      ') and scroll down to Saved for Later, then click the bookmarklet again.', function (row) {
      row.appendChild(addButton('Close', closeOverlay));
    });
  }

  function showSaved(name) {
    render('Saved ' + name, function (row) {
      row.appendChild(addButton('Close', closeOverlay));
    });
  }

  function showDone(items) {
    var withPictures = items.filter(function (item) { return item.images.length > 0; }).length;
    render('Found ' + items.length + ' item' + (items.length === 1 ? '' : 's') +
      ' (' + withPictures + ' with pictures)', function (row) {
      row.appendChild(addButton('Download file', function () {
        showSaved(downloadExport(items));
      }));
      row.appendChild(addButton('Cancel', closeOverlay));
    });
  }

  /* ---------- Main ---------- */
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  async function run() {
    var started = Date.now(), stable = 0, lastCount = -1, items = findItems();
    showProgress(items.length);
    while (!cancelled && Date.now() - started < MAX_LOAD_MS) {
      if (items.length) {
        items[items.length - 1].scrollIntoView({ block: 'end' });
      }
      clickLoadMore(items);
      await sleep(ROUND_MS);
      if (cancelled) { return; }
      items = findItems();
      showProgress(items.length);
      stable = items.length === lastCount ? stable + 1 : 0;
      lastCount = items.length;
      if (stable >= STABLE_ROUNDS) { break; }
    }
    if (cancelled) { return; }
    var extracted = extractAll(items);
    if (extracted.length === 0) { showZero(); } else { showDone(extracted); }
  }

  run().catch(function (err) {
    if (!cancelled) {
      render('Saved for Later export failed: ' + clean(err && err.message), function (row) {
        row.appendChild(addButton('Close', closeOverlay));
      });
    }
  });
})();
