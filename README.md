# Amazon Saved for Later export

Save the **Saved for Later** list under your Amazon cart as a JSON file, in one click.

It's a bookmarklet: a bookmark that runs a small script on the page you're looking at. It reads
the list straight off your cart page and hands you a file. Nothing is sent anywhere.

**[→ Install it from the install page](https://mcgullicuddy.github.io/amazon-saved-for-later-export/)**

## Why

Amazon gives Saved for Later no export, no sharing and no API. Unlike a Wish List, it can't be
made public. This gets it out as a file you can do whatever you like with: a gift list on your
own site, a spreadsheet, a price tracker.

## How to use it

### 1. Install (once)

1. **Show your bookmarks bar.** Press `Ctrl+Shift+B` (`⌘+Shift+B` on a Mac). This works in most
   browsers.
2. **Open the [install page](https://mcgullicuddy.github.io/amazon-saved-for-later-export/).**
3. **Drag the "Saved for Later → JSON" button onto your bookmarks bar.**

Can't drag it? Add a bookmark by hand instead: call it anything, and paste the contents of
[bookmarklet.txt](https://mcgullicuddy.github.io/amazon-saved-for-later-export/bookmarklet.txt)
as its URL.

### 2. Export your list

1. **Open your Amazon cart** while signed in.
2. **Click the bookmark.** A panel appears in the top right corner. It scrolls through Saved for
   Later, loading every item. This takes a few seconds, or up to a minute for a long list.
3. **Click "Download file"** when the panel says *Found N items*.

The file lands in your Downloads folder as `amazon-saved-for-later-YYYY-MM-DD.json`.

### 3. Use the file

It looks like this:

```json
{
  "format": "amazon-saved-for-later",
  "version": 2,
  "exportedAt": "2026-01-15T18:30:00.000Z",
  "store": "www.amazon.com",
  "items": [
    {
      "asin": "B0ABCDEFGH",
      "title": "Product title as shown in the cart",
      "price": "$19.99",
      "priceValue": 19.99,
      "images": ["https://m.media-amazon.com/images/I/…jpg"]
    }
  ]
}
```

Each item's product page is `https://<store>/dp/<asin>`. [FORMAT.md](FORMAT.md) explains
every field, and how to pick the right picture from `images`.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| A popup: *open your Amazon cart page first* | You're not on an Amazon store. Open your cart and click the bookmark again. |
| *No Saved for Later items found* | Make sure you're on the cart page and Saved for Later is below the cart, then click again. If it still finds nothing, Amazon may have changed its page: please [open an issue](https://github.com/McGullicuddy/amazon-saved-for-later-export/issues) and say which Amazon store you use. |
| Fewer items "with pictures" than you expected | Scroll down to the end of the list so Amazon loads every picture, then click again. |
| A very long list is missing items at the end | It gives up loading after one minute. Scroll down to the end of the list, then click again. |
| Nothing happens when you click it | Check the bookmark's URL starts with `javascript:`. If it was cut short, add it again from `bookmarklet.txt`. |

## Is it safe?

A bookmarklet runs with full access to the page you click it on, which here is your signed-in
Amazon page. **Read the source of any bookmarklet before you install it.** This one is
[one file](src/bookmarklet.js). Here is what it does and doesn't do:

- **Sends nothing.** It makes no network requests at all. The file is built in your browser and
  handed straight to your browser's download. The tests block and log every request the browser
  makes while the bookmarklet runs, and fail if there is even one.
- **Runs only on Amazon.** It checks the page's address against Amazon's own store addresses
  (amazon.com, amazon.co.uk, amazon.de and so on) and refuses to run anywhere else, including
  lookalike addresses.
- **Clicks only "See more".** The only thing it clicks is Saved for Later's own "See more" or
  "Load more" control. It never adds, removes or buys anything.
- **Needs no permissions.** It isn't a browser extension. It can't do anything until you click
  it, and it stops when it's done.
- **What you install is what's here.** The install page is rebuilt from `src/bookmarklet.js` by
  this repository's [GitHub Actions workflow](.github/workflows/ci.yml) on every change.

## Limits

- **Amazon's page can change.** It reads Amazon's page layout, which changes without notice.
- **Only amazon.com is tested.** Other Amazon stores are allowed and should work.
- **Desktop browsers only.** Bookmarklets are awkward on phones.
- **Prices are a snapshot** of what the cart showed when you exported.
- **Amazon's terms.** Amazon's Conditions of Use restrict automated data gathering. This only
  reads a page you opened yourself, when you click it, and makes no requests of its own.
  Whether that suits you is your call.

This is a personal tool, maintained on a best-effort basis.

## Development

You need Node.js 20 or newer.

```bash
npm ci                            # install the test dependency (Playwright)
npx playwright install chromium   # once: download the browser the tests use
npm test                          # run the built bookmarklet against a made-up cart page
npm run build                     # write dist/: bookmarklet.txt and the install page
```

| Path | What it is |
| --- | --- |
| `src/bookmarklet.js` | The bookmarklet's readable source. |
| `scripts/build.mjs` | Turns the source into a `javascript:` URL and fills in the install page. Uses only Node's built-in modules. |
| `site/` | The install page template and its stylesheet. |
| `test/` | The test, and `fixture-cart.html`: a made-up page that copies the shape of Amazon's cart. |
| `FORMAT.md` | The file format. |

Two rules:
- **Comments in `src/bookmarklet.js`** must be whole-line `/* */` blocks. The build strips them
  line by line, and stops with an error if a comment marker survives.
- **Test data stays made up.** For a new Amazon layout, add a made-up case to
  `test/fixture-cart.html`. Never paste a real cart.

## License

[MIT](LICENSE). Not affiliated with or endorsed by Amazon. Amazon is a trademark of Amazon.com,
Inc. or its affiliates.
