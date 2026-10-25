# Translating Fleet Check

Fleet Check is an app for Amazon delivery partners in Europe (DSPs, "Delivery Service Partners"): companies with
a few dozen delivery vans and drivers at one or more Amazon stations. Drivers photograph the van at pick-up and
drop-off (a "walk-around"), the AI looks for damage, the fleet manager decides; drivers also photograph the
dashboard at the start and end of a tour, refuel and wash the vans (with a fuel card check), and managers keep the
vans' and drivers' records. Readers: **drivers** (often not native speakers of the country's language, on a phone,
in a hurry, sometimes at a petrol pump), **fleet managers** and **fleet owners** (office, phone or computer).

## The file

- `i18n/keys.json`: every English text the app shows (`key`). Counts also have `one` (the English singular); the key
  is the English plural. `where` says which file and line shows it: open it when a short text is ambiguous.
- Your output: `public/i18n/<code>.json`, one object: `{ "English key": "translation", ... }`. For counts:
  `{ "English plural key": { "one": "...", "few": "...", "other": "..." } }` with exactly the forms your language
  needs (`node scripts/i18n.mjs --lang=<code>` says which, and lists missing and broken entries).

## Rules

1. Keep every `{placeholder}` exactly as written (same name, in braces, untranslated); move it where your grammar
   needs it. Never add one that isn't in the English. `{n}` in counts is the number.
2. Keep it short: button labels must fit on a phone. Prefer the shortest natural phrasing.
3. Sentence case as in the English. Keep the punctuation style (full stops on sentences, none on buttons).
4. Address the reader the way modern apps in your language do (e.g. German "du", French "vous"), and stay
   consistent across the whole file.
5. Don't translate: Fleet Check, Amazon, Expo Go, Excel, Firebase, Claude, Haiku, Sonnet, Opus, GitHub, Anthropic,
   DKV, Shell, Aral, units (km, l, kWh, €, %, km/h, l/100 km, kWh/100 km), HU, UVV, AU, VIN, AdBlue, Euro 6,
   "Transporter ID" (Amazon's term; you may add your language's word only if drivers would otherwise not
   understand), plates and example names (Dana, Berlin Spandau, DBE1).
6. Some keys are just a placeholder like `{issue}` or `{name}`: return them unchanged.
7. Dates are filled in by the app; never write a date format into a translation unless the English has one
   (e.g. "03/2027": keep it).
8. Translate meaning, not words. If an English sentence is awkward in your language, rephrase it naturally.

## Terms (keep each term the same everywhere)

| English | Meaning |
|---|---|
| van | the delivery vehicle (in German "Transporter", not "Van") |
| fleet | all the company's vans |
| fleet owner / owner | the owner of the delivery company (DSP) |
| fleet manager / manager | runs one station: vans, drivers, damage decisions |
| driver | delivery driver |
| station | an Amazon delivery station (an operating area); keep the word your drivers use for Amazon stations |
| company | the delivery company (DSP) |
| walk-around | photos all around the van (a vehicle check walk-around) |
| damage check | the AI's search for damage on a walk-around, then the manager's review |
| spot | a place the AI thinks might be damage |
| close-up | a near photo of one spot |
| review / to review | the manager deciding about each spot; also the tab name "Review" (keep it a noun there) |
| damage record | the list of approved damage on a van |
| pick-up / drop-off | the driver taking / returning a van (handover) |
| handover | a pick-up or drop-off |
| tour | a driver's delivery day with a van (Amazon "route"); "tour" is the app's word |
| dashboard photo | a photo of the instrument cluster (odometer, fuel gauge, warning lights) |
| odometer | total km of the van |
| fuel gauge | the needle/bars of the fuel level |
| warning light | a lit symbol on the dashboard |
| refuel / wash / parts | the three purchase kinds (buttons) |
| fuel card | the company's card for fuel (DKV, Shell...) |
| receipt | the paper slip from the pump or shop |
| invite link | one-time link to join the company |
| Data (tab) | the tables with numbers |
| Test log (tab) | the app creator's log of AI tests |
| app creator | the person who runs Fleet Check itself |
| View as | the app creator seeing the app as another role |
| licence check | the manager checking a driver's driving licence |
| incident | accident, traffic fine, customer complaint |
| deadline / due | inspection, service, tax, insurance, contract end dates |
