import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Compare direct advisory identities so existing findings do not obscure newly
// introduced high/critical dependencies. No installs or package scripts run.
const base = process.env.PR_BASE_SHA;
if (!/^[0-9a-f]{40}$/.test(base ?? '')) throw new Error('PR_BASE_SHA must be a commit SHA');
function audit(ref) {
  const directory = mkdtempSync(join(tmpdir(), 'trade-dependency-review-'));
  try {
    for (const file of ['package.json', 'package-lock.json']) {
      writeFileSync(join(directory, file), execFileSync('git', ['show', `${ref}:${file}`]));
    }
    const result = spawnSync('npm', ['audit', '--package-lock-only', '--ignore-scripts', '--json'], {
      cwd: directory, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    const payload = JSON.parse(result.stdout);
    if (payload.error || !payload.metadata || ![0, 1].includes(result.status)) {
      throw new Error(`Dependency audit unavailable for ${ref}`);
    }
    const findings = new Map();
    for (const vulnerability of Object.values(payload.vulnerabilities ?? {})) {
      for (const advisory of vulnerability.via ?? []) {
        if (typeof advisory !== 'object' || !['high', 'critical'].includes(advisory.severity)) continue;
        const id = `${advisory.name}:${advisory.source}`;
        findings.set(id, { id, severity: advisory.severity, title: advisory.title, url: advisory.url });
      }
    }
    return findings;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const before = audit(base);
const after = audit('HEAD');
const introduced = [...after.values()].filter(({ id }) => !before.has(id));
console.log(JSON.stringify({ existingHighOrCriticalAdvisories: before.size, currentHighOrCriticalAdvisories: after.size, introduced }, null, 2));
if (introduced.length) process.exitCode = 1;
