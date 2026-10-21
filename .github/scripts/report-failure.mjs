/* GitHub shows a workflow annotation for every ::error:: line, and annotations
   are readable over the API even when the raw job log is not. The sandbox that
   wrote this workflow could not fetch blob-storage logs, so a failing build
   reports its own tail here instead of hiding inside a log file. */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
let text = '';
try {
  text = readFileSync(file, 'utf8');
} catch {
  console.log('::error::no build log was captured');
  process.exit(0);
}

const escape = (line) =>
  line.replace(/%/g, '%25').replace(/\r/g, '').replace(/::/g, ': :').slice(0, 900);

const lines = text.split('\n').filter((line) => line.trim() !== '');
const interesting = lines.filter((line) =>
  /error|fail|not ok|cannot|unable|⨯|errno|expected|actual|missing|denied/i.test(line)
);
const picked = [...new Set([...interesting.slice(-18), ...lines.slice(-8)])];

for (const line of picked) console.log(`::error::${escape(line)}`);
