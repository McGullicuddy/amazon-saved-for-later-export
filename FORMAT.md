# Export format

The bookmarklet downloads one UTF-8 JSON file, named `amazon-saved-for-later-YYYY-MM-DD.json` after the
date on your computer.

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
      "images": [
        "https://m.media-amazon.com/images/I/71abcDEF12L._AC_AA880_.jpg",
        "https://m.media-amazon.com/images/I/71abcDEF12L._AC_AA440_.jpg"
      ]
    }
  ]
}
```

## Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `format` | string | Always `"amazon-saved-for-later"`. Check it before reading anything else. |
| `version` | number | `2`. A change that breaks readers bumps it. Adding an optional field does not. |
| `exportedAt` | string | When the file was made, ISO 8601 in UTC. |
| `store` | string | The Amazon hostname it ran on, such as `www.amazon.com` or `www.amazon.co.uk`. Just the hostname: no path, no query string. |
| `items` | array | Saved for Later, in the order the cart shows it. |

## Items

| Field | Type | Meaning |
| --- | --- | --- |
| `asin` | string | Amazon's product ID: 10 capital letters or digits. Unique within the file. `https://<store>/dp/<asin>` is the product page. |
| `title` | string | The title as the cart shows it, with whitespace collapsed. Never cut short. It can be empty if the page had none. |
| `price` | string or `null` | The price as displayed, with its currency, such as `"$19.99"` or `"19,99 €"`. If there's no displayed price but the item carries a numeric one, it is used instead: with `$` on amazon.com, and as a bare number elsewhere. `null` when the item shows no price (often "currently unavailable"). |
| `priceValue` | number or `null` | The numeric price Amazon attaches to the item, for sorting or totals. `null` when missing or zero. Added in version 2. Readers that don't know it can ignore it. |
| `images` | array of strings | Candidate picture URLs, **raw and unfiltered**. Explained below. |

## Reading the file safely

Every string in the file was copied off a web page, and anyone can hand-edit a file before
passing it on. Treat it all as untrusted input:

- **HTML.** Escape titles and prices before putting them in a page. Never insert them as HTML.
- **Inside a `<script>` tag.** If you embed the JSON in a page, escape every `<` as `<`, so
  a title containing `</script>` can't end the tag. Serving it as a separate `.json` file avoids
  the problem.
- **Spreadsheets.** A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return can
  run as a formula in Excel, Sheets or LibreOffice. When converting to CSV or XLSX, put a `'` in
  front of such titles and prices, or use your library's escaping option.
- **Shell commands and SQL.** Pass values as arguments or query parameters. Never paste them into a
  command string.
- **Links.** Build product links from the ASIN, after checking it is 10 capital letters or
  digits, and from a `store` you have checked is an Amazon hostname. Don't take any other URL
  from the file at face value.
- **Unusual characters.** Titles can hold any Unicode, including zero-width and right-to-left
  control characters. Strip them if they would confuse your display.
- **Picture URLs.** These need the most care; see the next section.

## Picture URLs

Amazon's cart markup varies, so the bookmarklet doesn't try to guess which URL is "the" picture.
It records every `http(s)` URL it finds on the item's `<img>` elements and leaves the choice to
you.

- **Order:** elements with class `sc-product-image` first, then the rest in page order. For each
  element the attributes are read in this order:
  - `data-a-hires`
  - every `srcset` entry, largest first
  - `data-old-hires`
  - `data-src`
  - `currentSrc`
  - `src`

  The first entry is usually the largest product photo.
- **Duplicates, other schemes and limits:** duplicates are removed, `data:` and other non-http(s)
  values are skipped, URLs over 1000 characters are skipped, and at most 12 are kept per item.
- **Picture outside the item's element:** if the item element has no `<img>` of its own, the
  bookmarklet looks up to 4 parent elements up. It stops at a parent that also contains another
  item, so it never borrows a neighbour's picture.

Patterns seen on amazon.com in November 2026:

- **Product photos** are `https://m.media-amazon.com/images/I/<id>._<size token>_.jpg`. The size
  token (`_AC_AA880_`, `_SS144_` and so on) can be swapped for another size. For example,
  `._AC_SL500_.` gives a picture whose longer side is 500 px.
- **Experiment paths.** Some photos sit behind an experiment path,
  `https://m.media-amazon.com/images/W/<experiment>/images/I/<id>…`. It is the same picture as
  `/images/I/<id>…` without the prefix.
- **The real URLs are in `srcset`.** The `src` attribute is often a loading animation,
  `/images/G/01/ui/loadIndicators/loading-large…gif`.
- **Badges and icons** come after the product photo, such as `/images/I/<id>.svg` and
  small `_SS144_.png` files.

A reasonable reader:
- keeps only `https` URLs on Amazon's picture hosts: `m.media-amazon.com`, and the older
  `images-na.ssl-images-amazon.com` and its siblings, which serve the same IDs;
- keeps only `/images/I/` URLs, after removing any `/images/W/<experiment>` prefix;
- ignores `.svg` files;
- tries the candidates in order and uses the first that downloads.

**Downloading pictures on a server.** Never fetch a URL from the file just because it is there.
Whoever made the file chose those URLs, so fetching them blindly lets them make your server
request anything it can reach, including internal addresses. This is server-side request
forgery. Check each URL against the host list above first. Then refuse redirects, cap the
download size and time, and check that what arrives is really an image.

## Versions

- **2** is the first published version.
- Version 1 was an unreleased draft that sent the list to a web page instead of saving a file.
