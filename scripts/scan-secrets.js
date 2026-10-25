import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
execFileSync(process.execPath, ['scripts/check-public-source.js'], { stdio: 'inherit' });
const directory = await mkdtemp(path.join(tmpdir(), 'agent4-public-source-'));
try {
  execFileSync('git', ['checkout-index', '--all', `--prefix=${directory}/`], { stdio: 'inherit' });
  const local = spawnSync('gitleaks', ['version'], { stdio: 'ignore' });
  if (local.status === 0) {
    execFileSync('gitleaks', ['git', '.', '--config', '.gitleaks.toml', '--redact', '--no-banner'], { stdio: 'inherit' });
    execFileSync('gitleaks', ['dir', directory, '--config', '.gitleaks.toml', '--redact', '--no-banner'], { stdio: 'inherit' });
  } else {
    const image = 'ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f';
    execFileSync('docker', ['run', '--rm', '-v', `${process.cwd()}:/repo:ro`, '-w', '/repo', image, 'git', '.', '--config', '.gitleaks.toml', '--redact', '--no-banner'], { stdio: 'inherit' });
    execFileSync('docker', ['run', '--rm', '-v', `${directory}:/source:ro`, '-v', `${process.cwd()}/.gitleaks.toml:/scan.toml:ro`, image, 'dir', '/source', '--config', '/scan.toml', '--redact', '--no-banner'], { stdio: 'inherit' });
  }
} finally {
  // The only deletion target is the directory this process just created.
  await rm(directory, { recursive: true, force: true });
}
