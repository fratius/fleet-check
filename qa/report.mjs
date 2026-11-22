// Turns the blind tester's transcript into report.md (qa/run.sh calls it): the tester's own report, or what is
// known when the run ended before it; then how the run went (cost, actions, time) and a check that the tester
// really had only the browser (its tool list at start). Also writes the GitHub step summary and outputs.
// Run: node qa/report.mjs <QA_DIR>
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('Usage: node qa/report.mjs <QA_DIR>');
const lines = existsSync(join(dir, 'transcript.jsonl')) ? readFileSync(join(dir, 'transcript.jsonl'), 'utf8').split('\n') : [];
const events = lines.filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
const result = events.findLast((e) => e.type === 'result');
const texts = [];
let actions = 0;
for (const e of events) {
  if (e.type !== 'assistant') continue;
  for (const c of e.message?.content || []) {
    if (c.type === 'text' && c.text?.trim()) texts.push(c.text.trim());
    if (c.type === 'tool_use') actions++;
  }
}

// Blind: every tool it had is one of the browser's. Anything else (files, shell, web) means it could have read code.
const tools = init?.tools || [];
const notBrowser = tools.filter((t) => !t.startsWith('mcp__browser__browser_'));
const blind = init ? notBrowser.length === 0 : null;

const report = (result?.result || '').trim();
const hasReport = /#\s*Blind QA report/i.test(report);
const verdict = hasReport ? (report.match(/Verdict:\s*([A-Z ]+?)\s*$/m)?.[1] || 'UNKNOWN') : 'NO REPORT';
const counts = Object.fromEntries(['blocker', 'major', 'minor', 'nit'].map((s) => [s, (report.match(new RegExp(`^###\\s*F\\d+\\s+${s}\\b`, 'gim')) || []).length]));
// Screenshots it named itself land in its folder, the others in shots/.
const pics = (d) => (existsSync(d) ? readdirSync(d).filter((f) => /\.png$/i.test(f)) : []);
// Acceptance criteria: one row per approved line, PASS / FAIL / NOT TESTED. The loop is done only when all pass.
const crit = [...report.matchAll(/^\|\s*(A\d+)[^|]*\|\s*(PASS|FAIL|NOT TESTED)\s*\|/gim)].map((m) => ({ id: m[1].toUpperCase(), v: m[2].toUpperCase() }));
const critOpen = crit.filter((c) => c.v !== 'PASS').map((c) => `${c.id} ${c.v}`);
const shots = [...pics(dir), ...pics(join(dir, 'shots'))];

let md = hasReport ? report : [
  '# Blind QA report',
  '',
  `Verdict: NO REPORT. The run ended before the tester wrote its report (${result ? `${result.subtype}${result.is_error ? ', error' : ''}` : 'no result: see claude.log'}).`,
  '',
  '## The last thing the tester wrote',
  '',
  ...(texts.slice(-3).map((t) => `> ${t.replace(/\n/g, '\n> ')}\n`)),
].join('\n');

// On the subscription token nothing is billed: this is what it would have cost on the API, as a size of the run.
const usd = result?.total_cost_usd != null ? `about $${result.total_cost_usd.toFixed(2)} at API prices (on the plan's usage, not billed)` : 'size unknown';
const mins = result?.duration_ms != null ? `${Math.round(result.duration_ms / 60000)} min` : 'unknown';
md += `\n\n---\n**How the run went:** ${actions} browser actions, ${mins}, ${usd}, model ${init?.model || 'unknown'}, ${shots.length} screenshots (workflow artifact "blind-qa").\n`;
if (crit.length) md += `**Acceptance criteria:** ${crit.length - critOpen.length} of ${crit.length} pass${critOpen.length ? `; open: ${critOpen.join(', ')}` : ''}.\n`;
md += blind === true
  ? `**Blind:** yes. The tester had ${tools.length} tools, all of them the browser's: no files, no shell, no code.\n`
  : blind === false
    ? `**Blind: NO.** The tester also had ${notBrowser.join(', ')}. Treat this run as not blind and fix qa/run.sh.\n`
    : '**Blind:** unknown (the tester never started; see claude.log).\n';

writeFileSync(join(dir, 'report.md'), md);
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${verdict}\nblockers=${counts.blocker}\nmajors=${counts.major}\nblind=${blind}\ncriteria=${crit.length}\ncriteria_open=${critOpen.length}\n`);
}
if (blind === false) console.log('::error title=Blind QA::The tester had tools other than the browser: ' + notBrowser.join(', '));
if (counts.blocker) console.log(`::warning title=Blind QA::${counts.blocker} blocker finding(s): see the report.`);
