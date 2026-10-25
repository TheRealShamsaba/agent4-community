import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
// Keep the public guard generic. Deployment-specific deny lists belong in a
// private audit, including hashes or other derivatives of personal identifiers.
const exampleDomain = domain => /(^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/.test(domain);
const files = execFileSync('git', ['ls-files','--cached','--others','--exclude-standard','-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const failures = [];
for (const file of files) {
  if (/^(?:data|backups|\.secrets|deploy)\//.test(file) || /(?:^|\/)\.env(?:$|\.(?!example$))/.test(file) || /\.(?:sqlite(?:-wal|-shm)?|db|pem|key|p12|pfx)$/.test(file) || /(?:^|\/)(?:OPEN_SOURCE_AUDIT\.md|hq-template\.html)$/.test(file)) {
    failures.push(`${file}: private/runtime file is in the public source set`); continue;
  }
  if (lstatSync(file).isSymbolicLink()) { failures.push(`${file}: review symlinks before distribution`); continue; }
  const buffer = readFileSync(file);
  if (buffer.includes(0)) {
    if (!/^docs\/images\/.*\.(png|jpg|webp)$/.test(file)) failures.push(`${file}: unreviewed binary file`);
    continue;
  }
  const content = buffer.toString('utf8');
  let line = 0;
  for (const text of content.split('\n')) {
    line++;
    if (/(?:\/Users\/|\/home\/)[^\s]+/.test(text)) failures.push(`${file}:${line}: personal machine path`);
    for (const email of text.matchAll(/[a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)) {
      if (!exampleDomain(email[1].toLowerCase()) && email[1].toLowerCase() !== 'users.noreply.github.com' && email[0] !== 'local@agent4.dev') failures.push(`${file}:${line}: use an example email address`);
    }
  }
}
const env = readFileSync('.env.example', 'utf8');
for (const line of env.split('\n')) {
  if (/^(?!#)[A-Z0-9_]*(?:TOKEN|PASSWORD|API_KEY|SECRET|CLIENT_EMAIL|CLIENT_WHATSAPP|OWNER_USER_ID|OWNER_CHAT_ID)=.+/.test(line)) failures.push('.env.example: connection credentials or personal contact defaults must be blank');
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Public source guard passed for ${files.length} files. Runtime files, personal emails, machine paths and sample credentials are excluded.`);
