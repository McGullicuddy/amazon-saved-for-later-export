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
| `asin` | string | Amazon's product ID: 10 capital letters or digits. Unique within the file. `https://www.amazon.<store tld>/dp/<asin>` is the product page. |
| `title` | string | The title as the cart shows it, with whitespace collapsed. Never cut short. It can be empty if the page had none. |
| `price` | string or `null` | The price as displayed, with its currency, such as `"$19.99"` or `"19,99 €"`. If there's no displayed price but the item carries a numeric one, it is used instead: with `$` on amazon.com, and as a bare number elsewhere. `null` when the item shows no price (often "currently unavailable"). |
| `priceValue` | number or `null` | The numeric price Amazon attaches to the item, for sorting or totals. `null` when missing or zero. Added in version 2. Readers that don't know it can ignore it. |
| `images` | array of strings | Candidate picture URLs, **raw and unfiltered**. Explained below. |

**Treat every string as untrusted text.** It was copied off a web page. Escape titles before
putting them in HTML, and build links from the ASIN rather than trusting anything else in the
file.

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
- keeps only `/images/I/` URLs, after removing any `/images/W/<experiment>` prefix;
- ignores `.svg` files;
- tries the candidates in order and uses the first that downloads.

Older Amazon image hosts (`images-na.ssl-images-amazon.com` and others) serve the same IDs.

## Versions

- **2** is the first published version.
- Version 1 was an unreleased draft that sent the list to a web page instead of saving a file.
