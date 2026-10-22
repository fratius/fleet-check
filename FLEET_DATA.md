# Fleet Check as the fleet's database

Fleet Check is not only for damage. It is also where a delivery company keeps the records of its **vans** and its
**drivers**, so an owner or fleet manager can answer from one place: what is this van, what does it cost, what is
due on it, who drives it, who drove it before, how far and how economically each driver drives, and what happened
with whom.

Rules that apply to every record here (see ROLES.md):

- Every record belongs to a company and a station. Owners see all stations, managers their own, drivers only what
  they need at the van.
- Business data (contracts, insurance terms) is kept apart from what drivers see, and costs apart from what
  managers see; the access rules enforce it. Hiding it on the screen is not enough.
- Vans and people are never deleted; vans are retired, people removed. Their history stays.

## Vans (built)

The van page has three parts under the van's status and actions: **Damage**, **Details**, **Drivers**.
Details holds the record, in sections that are each edited on their own.

### What everyone at the van's station sees

Stored on the van itself (`orgs/{org}/vehicles/{id}`). Owners and the station's managers fill it in.

| Section | Fields |
|---|---|
| Vehicle | VIN (17 characters), first registration, model year, fuel (diesel, electric, petrol, hybrid, gas), fuel tank in litres, battery and range for electric and hybrid vans, power, gearbox, colour, livery (Amazon or plain), number of keys |
| Size and load | height (for car parks and garages), length, gross weight, payload, cargo space, tyre size |
| If something happens | breakdown help number, accident claims number, insurer, policy number (drivers need these at the van) |

### What only owners and the station's managers see

Stored apart (`orgs/{org}/vehicleDetails/{vehicleId}`), readable and writable only by owners and the managers of
the van's station; the server moves it with the van when the van changes station.

| Section | Fields |
|---|---|
| Mileage | odometer and the day it was read (every dashboard photo updates it) |
| Contract | owned, leased, rented, financed or other; leasing company, landlord or seller; contract number; start and end; kilometres allowed a year; odometer at the start; what's included (maintenance, tyres, insurance, breakdown cover, replacement van); contact; return conditions |
| Insurance | cover (liability only, partial, full), renewal date |
| Deadlines | main inspection (HU, the month on the sticker), yearly safety check for company vehicles (UVV), service by date and by distance, tyre change, vehicle tax |
| Fuel card and notes | the fuel or charging card (provider and last digits only, never the full number or PIN), free notes |

### What only owners see

What a van costs, in `orgs/{org}/vehicleCosts/{vehicleId}`: monthly rate (without VAT), purchase price, price of
each kilometre over the allowance, insurance premium a year and deductible. Managers don't see it; the rules
refuse money in the record managers read. With it the app shows owners the extra cost of driving over the
allowance and what the monthly rate comes to per kilometre.

### What the app does with it

- **Coming up** on the van: every deadline soonest first, with the inspection sticker drawn in that year's colour.
  The insurance renewal and the end of a lease, rental or financing count too.
  - Overdue is red.
  - "Soon" is amber: within 30 days, tyres 21, insurance 45, contract end 90.
  - The service by distance turns amber 2,000 km before.
- **Fleet list**: the most pressing deadline on each van.
- **Review tab**: a "Due soon" category. Its badge counts what is overdue or due within a week.
- **Mileage against the allowance**: from the contract start, the odometer at the start and the latest reading,
  the yearly pace and how far over or under the allowance it is (the estimated extra cost for owners).
- The page header shows fuel and height at a glance.

## Drivers (built)

Each person's page has three parts under their details and the van they have now: **Record**, **Tours**, **Vans**.

### The record

`orgs/{org}/driverRecords/{uid}`. Owners and the managers of the driver's station keep it; the driver reads their
own (read only). It carries the driver's station and moves with them.

| Section | Fields | Why |
|---|---|---|
| Licence checks | day, who checked, fine or the problem; the next check is due after the company's interval (3, 6 or 12 months, set by the owner, 6 by default) | The vehicle keeper has to make sure drivers hold a valid licence; regular checks are the usual way, and the dates are the proof. Added only by the server, never changed; nobody checks their own. |
| Driving licence | classes (B, C1, ...), valid until | Who may drive which van; when it runs out. |
| Employment | contract (full-time, part-time, mini-job, student job), start, last working day | Planning, and who may still drive. |
| Briefings | first briefing on the vans, last yearly safety briefing | Proof that a driver was briefed; the yearly one shows as a deadline. |
| Emergency contact | name and phone | After an accident. |
| Notes | free text (not shown to the driver) | |

### Incidents

`orgs/{org}/incidents`: accidents (driver at fault or not), traffic fines (speeding, parking, red light, phone,
other), customer complaints and other incidents, with the day, time, van and what happened. Owners and the
station's managers add and correct them; corrections show who made them; nobody deletes them. The driver reads
their own. When adding one, the app checks the van history: it suggests the van the driver had then and warns if
the history says someone else had it.

### Tours from dashboard photos (the owner turns it on)

- The driver photographs the dashboard when a tour starts and when it ends. The AI reads the odometer, the fuel
  gauge (or the battery for electric vans), the range and lit warning lights. The driver checks the numbers,
  corrects them, and at the end says whether they refuelled (litres from the receipt) or charged.
- The server (`readDashboard`, `saveReading`) starts or ends the tour, works out the kilometres, hours and, when it
  can, the fuel or energy used, and updates the van's odometer. The odometer can't go down; a jump of thousands of
  kilometres needs a confirmation.
- Pick-up and drop-off: the tour card is on the van and on the Vans tab. Where drivers keep a van for days, they
  start and end each tour with the photo. A tour of the same driver older than 16 hours is ended by their next
  photo; a tour someone left open is ended by the next driver's start photo (its kilometres are then an estimate,
  without a fuel figure); the station's manager can end it with a photo when the van is back.
- Warning lights on a van's latest photo show on the van and in Review ("Warning lights"). Tours without their
  start or end photo show in Review ("Missing proof").
- Records: `tours` and `readings` (written only by the server; owners and the station's managers read them, drivers
  their own), `dashReads` (what the AI read before the person confirmed it, with speed and cost: app creator only).
- Facts the numbers need: the tank size (diesel, petrol) or usable battery (electric) on the van.

How far to trust it (also on the screen):

- Kilometres come from the odometer: exact.
- A needle fuel gauge shows about a sixteenth of a tank (5 litres on an 80-litre tank). On one tour that is rough;
  over many tours it evens out. Electric vans show whole percent and are far more exact. Tours under 20 km get no
  fuel figure. Real litres come from the fuel card (later).
- Fuel use depends on route, load, weather and van as much as on the driver. A driver is compared only with the
  other drivers on the same van model, over the same kilometres, from 4 tours on. It shows who to talk to; it
  proves nothing.

### The damage log

`orgs/{org}/damageLog/{checkId}`, written by the server from every reviewed check (`logReview`; the Data tab fills
in missing ones with `syncDamageLog`): how many new damages the check found, and the drivers who had the van
between the walk-around before and the one it was found in. That is who had the van, not proof of who caused it.

### The Data tab (owners and managers)

Drivers, tours and vans as tables for 7 days, 30 days, 90 days or this year, per station; sorted by any column,
with totals. Download for Excel makes an .xlsx with the three sheets (filters on the header row).

- Drivers: tours, days with a van, km, km and hours per tour, l/100 km and kWh/100 km, against the others on the
  same van, vans driven, new damage (and damage while nobody else had the van, per 10,000 km), tours without the
  end photo, handovers without video, accidents (at fault), fines, complaints, licence valid until, next check.
- Tours: driver, start, van, end, hours, km, odometer, fuel or energy used, per 100 km, refuelled, end photo,
  warning lights.
- Vans: plate, model, fuel, odometer, km in the period, tours, drivers, per 100 km, against the same model (a van
  using more may need the workshop), new damage, warning lights, the next deadline; for owners the monthly rate
  and what it comes to per kilometre.
- **Who was driving?** Pick a van, a day and a time: the van history says who had it (for traffic fines and
  complaints that arrive days later).

### Kept out on purpose (GDPR, data minimisation)

- licence numbers, copies of licences or IDs (the licence check keeps the result and date, not the document);
- date of birth;
- home address;
- health data.

Recording how employees drive is employee monitoring. Drivers see their own record, tours and numbers. Before an
owner turns dashboard photos on, the app says to tell the drivers what is recorded and why, and to agree it with
the works council where there is one. A deletion period for the records of people who left is still to be set
(the van history keeps their name).

## Later

- **Fuel card import**: real litres and euros per van and driver from the fuel card provider, instead of the gauge.
- **Amazon's own driving data**: where a DSP gets safety scores per driver, importing them measures driving
  behaviour directly (fuel use only hints at it).
- **Documents**: registration certificate, lease contract, insurance card, as photos or PDFs on the van.
- **Service and repair log** with costs, and the cost per van per month (lease plus repairs plus fuel).
- **Reminders**: deadline notifications to the station's managers, by phone notification or email.
- **Deletion periods** for records of people who left, and for old dashboard photos.
