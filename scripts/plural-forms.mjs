// The plural forms each language needs in a translated count (same table as src/lib/i18n.ts).
const FORMS = {
  vi: ['other'], cs: ['one', 'few', 'many', 'other'], sk: ['one', 'few', 'many', 'other'], pl: ['one', 'few', 'many', 'other'],
  ru: ['one', 'few', 'many', 'other'], uk: ['one', 'few', 'many', 'other'], hr: ['one', 'few', 'other'], sr: ['one', 'few', 'other'],
  sl: ['one', 'two', 'few', 'other'], lt: ['one', 'few', 'many', 'other'], lv: ['zero', 'one', 'other'], ro: ['one', 'few', 'other'],
  ar: ['zero', 'one', 'two', 'few', 'many', 'other'], fr: ['one', 'many', 'other'],
};
export const formsOf = (code) => FORMS[code] || ['one', 'other'];
