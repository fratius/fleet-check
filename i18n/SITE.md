# Translating the website (fratius.com)

The website is `website/index.html`. It shows English first and translates itself in the browser into the
visitor's language (the browser's languages in order, else English; the visitor can switch in the header).
Readers are **fleet owners and managers** of delivery companies (DSPs) deciding whether to try Fratius, plus
drivers who open the link. The tone is plain, confident marketing: short sentences, no hype words.

## Files

- `i18n/site-keys.json`: every English text of the page (`key`), with an id and `where` (`page` = text on the
  page, `attribute …` = a screen-reader label or placeholder, `script` = drawn by the page's script).
  Made by `node scripts/site-i18n.mjs`.
- Output: `website/i18n/<code>.json`, one object `{ "English key": "translation", ... }` with every key.
- Check: `node scripts/site-i18n.mjs` lists what each language misses; `--strict` (CI) fails when a translation
  loses or invents a `{placeholder}`. Missing texts show in English until translated.

## Rules

Follow `i18n/GLOSSARY.md` (same terms and the same form of address as the app). For consistent terms, look up how
the app already says it in `public/i18n/<code>.json` (search for the English word: van, station, walk-around,
handover, tour, fuel card, review, damage record, licence check…). In addition:

1. Many texts are pieces of one line on the page; translate each so the line reads naturally:
   - `Every van. Every driver.` + `Right now.` are the two halves of the main headline (the second is highlighted).
   - Kickers: a bold time or moment, then a piece starting with `· ` (`At any moment` + `· owners and managers`,
     `05:45 and 16:40` + `· driver`). Keep the leading `· `.
   - In the example screens a bold label is followed by its value: `Service` + `at 90,000 km`, `Classes` +
     `B, C1 · valid to 2031`, `Next check` + `April 2027`, `Safety briefing` + `done 2 Sep`, `HU` + `March 2027`,
     `UVV` + `12 Nov`; a driver name is followed by `since 05:45`.
   - Store badges: a small line above the store name: `Coming soon to the` / `Download on the` + **App Store**,
     `Coming soon on` / `Get it on` + **Google Play**. Use your language's usual badge wording.
2. Ambiguous short texts: `Free` = vans not in use (available), not "free of charge". `Live` = live indicator.
   `Station` = the label above a station's name. `Check` = a warning light to check. `Review` = the app's Review
   tab (a noun). `Website` is a hidden spam-trap field label. `Driver` (table header) = the driver's name column.
   `Done` = sign-up finished. `Send` = the last sign-up step. `Plan`, `Company`, `Stations`, `Vans`, `Contact`,
   `Free until` = row labels of the sign-up summary.
3. Placeholders: `{n}` in `Up to {n} vans` is 50 or 150; in `{n} days free` it is 30; `{plan}` is Basic, Pro or
   Premium (never translated); `{store}` is App Store or Google Play; `{privacy}` / `{terms}` are links whose
   text is the separate keys `privacy policy` / `terms`; `{email}`, `{company}`, `{name}`, `{date}`, `{max}`,
   `{days}` as named.
4. Example data stays example data: keep names (Andrei M., Sofia K., Lukas B., Tomasz W., Elif D., Mehmet Y.),
   plates (B-FC 2041), DVIC, Amazon, Fratius, App Store, Google Play, Excel, AdBlue, VIN, HU, UVV, km, l, €.
   Write numbers, dates, times and months the way your language does (84.213 km, 62,4 l, 108,20 € in German).
5. `Impressum` is not in the list on purpose (German legal page name). The legal pages stay German/English.
