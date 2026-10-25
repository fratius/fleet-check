// The functions write notifications in each person's language with the app's translations (public/i18n), copied
// next to the built code when the functions are built.
const { cpSync, existsSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const from = join(__dirname, '..', '..', 'public', 'i18n');
const to = join(__dirname, '..', 'lib', 'i18n');
mkdirSync(to, { recursive: true });
if (existsSync(from)) cpSync(from, to, { recursive: true });
