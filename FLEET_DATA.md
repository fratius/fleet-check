# Fleet Check as the fleet's database

Fleet Check is not only for damage. It is also where a delivery company keeps the records of its **vans** and its
**drivers**, so an owner or fleet manager can answer from one place: what is this van, what does it cost, what is
due on it, who drives it, and who drove it before.

Rules that apply to every record here (see ROLES.md):

- Every record belongs to a company and a station. Owners see all stations, managers their own, drivers only what
  they need at the van.
- Business data (contracts, costs, insurance terms) is kept apart from what drivers see, and the access rules
  enforce it. Hiding it on the screen is not enough.
- Vans and people are never deleted; vans are retired, people removed. Their history stays.

## Vans (built)

The van page has three parts under the van's status and actions: **Damage**, **Details**, **Drivers**.
Details holds the record, in sections that are each edited on their own.

### What everyone at the van's station sees

Stored on the van itself (`orgs/{org}/vehicles/{id}`). Owners and the station's managers fill it in.

| Section | Fields |
|---|---|
| Vehicle | VIN (17 characters), first registration, model year, fuel (diesel, electric, petrol, hybrid, gas), battery and range for electric and hybrid vans, power, gearbox, colour, livery (Amazon or plain), number of keys |
| Size and load | height (for car parks and garages), length, gross weight, payload, cargo space, tyre size |
| If something happens | breakdown help number, accident claims number, insurer, policy number (drivers need these at the van) |

### What only owners and the station's managers see

Stored apart (`orgs/{org}/vehicleDetails/{vehicleId}`), readable and writable only by owners and the managers of
the van's station; the server moves it with the van when the van changes station.

| Section | Fields |
|---|---|
| Mileage | odometer and the day it was read |
| Contract | owned, leased, rented, financed or other; leasing company, landlord or seller; contract number; start and end; monthly cost without VAT; purchase price; kilometres allowed a year; odometer at the start; cost of each kilometre over; what's included (maintenance, tyres, insurance, breakdown cover, replacement van); contact; return conditions |
| Insurance | cover (liability only, partial, full), deductible, premium a year, renewal date |
| Deadlines | main inspection (HU, the month on the sticker), yearly safety check for company vehicles (UVV), service by date and by distance, tyre change, vehicle tax |
| Fuel card and notes | the fuel or charging card (provider and last digits only, never the full number or PIN), free notes |

### What the app does with it

- **Coming up** on the van: every deadline soonest first, with the inspection sticker drawn in that year's colour.
  The insurance renewal and the end of a lease, rental or financing count too.
  - Overdue is red.
  - "Soon" is amber: within 30 days, tyres 21, insurance 45, contract end 90.
  - The service by distance turns amber 2,000 km before.
- **Fleet list**: the most pressing deadline on each van.
- **Review tab**: a "Due soon" category. Its badge counts what is overdue or due within a week.
- **Mileage against the allowance**: from the contract start, the odometer at the start and the latest reading,
  the yearly pace and how far over or under the allowance it is, with the estimated extra cost.
- The page header shows fuel and height at a glance.

## Drivers (planned, not built yet)

Already recorded today:

- name, mobile number, email and Amazon Transporter ID (from the invite form);
- station and role;
- every van they had, from when to when, with the pick-up and drop-off proof;
- the damage found in those times.

Proposed next, for owners and the driver's station managers, and the driver for their own:

| Section | Fields | Why |
|---|---|---|
| Licence | licence classes (B, C1, ...), expiry date, last licence check (date, who checked it), next check due | In Germany the vehicle keeper must check employees' licences regularly (usually every 6 months). A missed check is a liability risk. The check dates are the proof. |
| Employment | start and end date, contract type (full-time, part-time, mini-job), work days | Planning, and who may still drive. |
| Onboarding | training done (vehicle, safety, the app), date | Proof that a driver was briefed before driving. |
| Emergency contact | name and phone | After an accident. |
| Incidents | accidents, traffic fines, damage the driver reported, with dates and the van | One place to see a driver's record, next to the damage history. |

Kept out on purpose (GDPR, data minimisation):

- licence numbers, copies of licences or IDs;
- date of birth;
- home address;
- health data.

The licence check records the result and date, not the document. Each field should have a stated reason and a
deletion period. For example, a driver's record is removed after a set time once they leave, while the van
history keeps their name.

The licence checks and onboarding dates would join the same deadlines view as the vans: overdue checks in
Review, and a badge in People.

## Later

- **Documents**: registration certificate, lease contract, insurance card, as photos or PDFs on the van.
- **Service and repair log** with costs, and the cost per van per month (lease plus repairs plus fuel).
- **Fuel and charging costs** imported from the fuel card provider.
- **Reminders**: deadline notifications to the station's managers, by phone notification or email.
- **Export** of the fleet to a spreadsheet, for the accountant or the leasing company.
