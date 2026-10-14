/** Prompts and answer schemas, ported from the browser test tool that ran the first Audi Q3 checks. */

export const CLASSES: { id: string; name: string; desc: string }[] = [
  { id: 'car', name: 'Car', desc: 'passenger car: hatchback, saloon or estate (Golf, Octavia, Corsa, Model 3)' },
  { id: 'suv', name: 'SUV or crossover', desc: 'SUV or crossover (Tiguan, Qashqai, RAV4, Kodiaq)' },
  { id: 'pickup', name: 'Pickup', desc: 'pickup truck with an open load bed (Hilux, Ranger, Amarok, Navara)' },
  { id: 'compact_van', name: 'Compact van', desc: 'small panel van on a car platform, up to about 4.8 m long (Caddy, Berlingo, Kangoo, Transit Connect, Partner)' },
  { id: 'midsize_van', name: 'Mid-size van', desc: 'medium panel van about 4.9 to 5.4 m long with a roof under about 2.1 m (Vito, Transit Custom, Transporter, Trafic, Vivaro, Expert)' },
  { id: 'large_van', name: 'Large van', desc: 'large panel van in short or standard length, about 5.3 to 6.4 m (Sprinter L1/L2, eSprinter, Crafter, Transit L2/L3, Ducato, Master, Daily, Movano)' },
  { id: 'large_van_long', name: 'Large van, extra long', desc: 'large panel van in its longest version, about 6.9 m or more, with a long cargo side between the sliding door and the rear wheel (Sprinter L3, Transit L4, Ducato XLWB, Master L4)' },
  { id: 'step_van', name: 'Step van', desc: 'walk-in delivery van with an upright front and a tall boxy body (Rivian EDV, Ford step van, Morgan Olson)' },
  { id: 'box_truck', name: 'Box truck', desc: 'van or light-truck chassis with a separate box body behind the cab, including Luton (Transit or Sprinter box van)' },
];
export const CLASS_IDS = CLASSES.map((c) => c.id);
export const className = (id: string) => CLASSES.find((c) => c.id === id)?.name || 'Vehicle';

export const DAMAGE_TYPES = ['scratch', 'scuff', 'dent', 'chip', 'crack', 'broken part', 'kerbed rim', 'other'];
export const VERDICTS = ['damage', 'dirt', 'reflection', 'no_damage', 'unclear'];

const nullable = (type: string, extra: object = {}) => ({ anyOf: [{ type, ...extra }, { type: 'null' }] });
const tri = { type: 'string', enum: ['yes', 'no', 'unknown'] };

/* ---------- 1. Which body class is this? ---------- */
export function identifyPrompt(n: number) {
  return `You are the check-in step of a fleet damage-inspection app. From ${n === 1 ? 'this photo' : `these ${n} photos`} of one vehicle, choose the body class that decides which walk-around photo frames the driver gets. The exact model matters less than the body shape, its length and its doors.

Body classes (answer with the id):
${CLASSES.map((c) => `- ${c.id}: ${c.desc}`).join('\n')}

Also report:
- roof: "high" for a raised roof clearly taller than the cab, "low" for a standard roof, "unknown" if you can't tell. Use "low" for cars, SUVs and pickups.
- slidingDoorLeft and slidingDoorRight: "yes", "no" or "unknown" for each side. Left and right are the vehicle's own sides as the driver sees them when seated. Use "unknown" for a side that isn't visible in any photo.
- rearDoors: "barn" (two side-hinged doors), "tailgate" (one top-hinged hatch or boot lid), "roller" (roll-up shutter), "open_bed" (pickup bed) or "unknown".
- make and model if you can recognise them, otherwise null.
- confidence: 0 to 1, how sure you are of the class.
- alternatives: up to 2 other classes that could also fit, each with a confidence.
- photoIssues: short phrases for problems that made identification harder, such as "too dark", "vehicle cut off", "only the rear visible". Empty if none.
- reason: one short sentence on what decided the class.
If there is no vehicle in the photos, set class to null and say why in photoIssues.`;
}
export const identifySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['class', 'confidence', 'make', 'model', 'roof', 'slidingDoorLeft', 'slidingDoorRight', 'rearDoors', 'alternatives', 'photoIssues', 'reason'],
  properties: {
    class: nullable('string', { enum: CLASS_IDS }),
    confidence: { type: 'number' },
    make: nullable('string'),
    model: nullable('string'),
    roof: { type: 'string', enum: ['high', 'low', 'unknown'] },
    slidingDoorLeft: tri,
    slidingDoorRight: tri,
    rearDoors: { type: 'string', enum: ['barn', 'tailgate', 'roller', 'open_bed', 'unknown'] },
    alternatives: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['class', 'confidence'], properties: { class: { type: 'string', enum: CLASS_IDS }, confidence: { type: 'number' } } } },
    photoIssues: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
};

/* ---------- 2. Find spots that could be damage ---------- */
export function findPrompt(vehicle: string, cls: string, labels: string[]) {
  return `You are the damage-detection step of a fleet inspection app. These ${labels.length} photos show one vehicle, ${vehicle} (${className(cls).toLowerCase()}), from a walk-around:
${labels.map((l, i) => `Image ${i + 1}: ${l}`).join('\n')}

Find every spot that could be damage to the body, bumpers, lights, glass, mirrors, trim or wheels: scratches, scuffs, dents, chips, cracks, broken or missing parts, kerbed rims.
A driver will take close-ups of every spot you list, so listing a doubtful spot is better than missing real damage. Leave out things you are sure are reflections, dirt, panel gaps, badges, sensors, design lines or tyre text.
Reflections move between photos of the same panel; damage stays in the same place on the panel. Use overlapping photos to tell them apart.
Dents show as a break or wobble in the reflected lines of a panel. Look along every edge and corner, where kerbs, posts and loading cause most damage.
If the same spot shows in several photos, list it once, using the photo where it is clearest.

For each spot give:
- image: the image number
- box: [x0, y0, x1, y1] around the spot as fractions of the image width and height (0 to 1, origin top left)
- panel: for example "front left wing", "rear bumper, right corner", "front right rim"
- type: one of ${DAMAGE_TYPES.join(', ')}
- sizeCm: rough size in centimetres
- confidence: 0 to 1 that it is real damage
- mightBe: "dirt", "reflection" or "none"
- closeup: one short instruction telling the driver where to stand for a close-up
Also give notVisible: short phrases for areas these photos can't show well (glare, cut off, too far away).
List at most 8 spots, most likely first. If you see nothing, return an empty list.`;
}
export const findSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['spots', 'notVisible'],
  properties: {
    spots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['image', 'box', 'panel', 'type', 'sizeCm', 'confidence', 'mightBe', 'closeup'],
        properties: {
          image: { type: 'integer' },
          box: { type: 'array', items: { type: 'number' } },
          panel: { type: 'string' },
          type: { type: 'string', enum: DAMAGE_TYPES },
          sizeCm: nullable('number'),
          confidence: { type: 'number' },
          mightBe: { type: 'string', enum: ['dirt', 'reflection', 'none'] },
          closeup: { type: 'string' },
        },
      },
    },
    notVisible: { type: 'array', items: { type: 'string' } },
  },
};

/* ---------- 3. Decide from the close-ups ---------- */
export function spotPrompt(vehicle: string, cls: string, spot: { panel: string; type: string; mightBe: string | null }, k: number) {
  return `This is a damage check of ${vehicle} (${className(cls).toLowerCase()}). Image 1 is part of a walk-around photo: the yellow box marks a spot on the ${spot.panel} that looked like a possible ${spot.type}${spot.mightBe ? ` (it might be ${spot.mightBe})` : ''}.
${k === 1 ? 'Image 2 is a close-up' : 'Images 2 and 3 are close-ups'} the driver took of that spot after wiping it${k === 2 ? ': image 2 straight on, image 3 from a low angle along the panel' : ''}.

Decide what is at the spot. Reflections change between the walk-around photo and the close-ups. Dirt usually wipes off. Real damage stays, and has edges, depth or broken paint.
verdict: damage, dirt, reflection, no_damage, or unclear (if the close-ups miss the spot or are blurry).
type and sizeCm only for damage, otherwise null. severity only for damage: cosmetic (polish or touch-up) or repair (bodyshop).
closeupBox: where the damage is in image 2, as [x0, y0, x1, y1] fractions of its width and height, or null.
reason: one or two sentences a fleet manager can check against the photos.`;
}
export const spotSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'type', 'sizeCm', 'severity', 'confidence', 'reason', 'closeupBox'],
  properties: {
    verdict: { type: 'string', enum: VERDICTS },
    type: nullable('string', { enum: DAMAGE_TYPES }),
    sizeCm: nullable('number'),
    severity: nullable('string', { enum: ['cosmetic', 'repair'] }),
    confidence: { type: 'number' },
    reason: { type: 'string' },
    closeupBox: { anyOf: [{ type: 'array', items: { type: 'number' } }, { type: 'null' }] },
  },
};
