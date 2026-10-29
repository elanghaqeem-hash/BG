#!/usr/bin/env node
/**
 * Read-only audit report for both npm lockfiles. This script does not mutate
 * dependencies and intentionally does not downgrade/waive advisories.
 */
import { readFileSync, appendFileSync } from 'node:fs';

const levels = ['critical', 'high', 'moderate', 'low', 'info'];
const output = ['# BG dependency security audit', ''];
let invalid = false;
for (const filename of process.argv.slice(2)) {
  let audit;
  try {
    audit = JSON.parse(readFileSync(filename, 'utf8'));
    if (!audit.metadata?.vulnerabilities || !audit.vulnerabilities) throw new Error('missing audit metadata');
  } catch {
    output.push('## ' + filename, 'Audit result unavailable or invalid. Treat as an audit failure.', '');
    invalid = true;
    continue;
  }
  const counts = audit.metadata.vulnerabilities;
  const findings = Object.entries(audit.vulnerabilities).sort((a,b) =>
    levels.indexOf(a[1].severity) - levels.indexOf(b[1].severity));
  output.push('## ' + filename,
    levels.map(k => k + ': ' + (counts[k] ?? 0)).join(' | '), '');
  for (const [pkg, item] of findings) {
    const advisories = (item.via || []).filter(x => x && typeof x === 'object')
      .map(x => x.url || x.name).filter(Boolean);
    const fix = item.fixAvailable === false ? 'no patch indicated'
      : item.fixAvailable === true ? 'compatible fix indicated'
      : typeof item.fixAvailable === 'object' ?
        'upgrade ' + item.fixAvailable.name + '@' + item.fixAvailable.version +
          (item.fixAvailable.isSemVerMajor ? ' (major)' : '')
        : 'undetermined';
    output.push('- ' + pkg + ' (' + item.severity + '; direct=' +
      Boolean(item.isDirect) + '; range=' + item.range + '; ' + fix + ')' +
      (advisories.length ? ' — ' + advisories.join(', ') : ''));
  }
  output.push('');
}
const summary = output.join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
if (invalid) process.exitCode = 1;
