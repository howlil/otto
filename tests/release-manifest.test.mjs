import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readBaseline } from '../scripts/release-version.mjs';

const root = resolve(import.meta.dirname, '..');

function fixture(pkg, tauri, cargo) {
  const dir = mkdtempSync(join(tmpdir(), 'otto-release-manifest-'));
  mkdirSync(join(dir, 'src-tauri'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: pkg }));
  writeFileSync(join(dir, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: tauri }));
  writeFileSync(join(dir, 'src-tauri/Cargo.toml'), `[package]\nname = "otto"\nversion = "${cargo}"\n`);
  return dir;
}

describe('release version sources', () => {
  test('three agreeing version sources produce the baseline', () => {
    const dir = fixture('1.4.2', '1.4.2', '1.4.2');
    try {
      expect(readBaseline(dir)).toEqual([1, 4, 2]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a drifted source version blocks the release instead of picking one', () => {
    for (const drifted of [
      ['1.4.2', '1.4.1', '1.4.2'],
      ['1.4.2', '1.4.2', '1.4.1'],
      ['1.4.1', '1.4.2', '1.4.2'],
    ]) {
      const dir = fixture(...drifted);
      try {
        expect(() => readBaseline(dir)).toThrow('Source versions must match');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test('a non-semver baseline cannot become a release', () => {
    const dir = fixture('1.4', '1.4', '1.4');
    try {
      expect(() => readBaseline(dir)).toThrow('Source versions must match');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the repository baseline is release-ready', () => {
    expect(readBaseline(root)).toHaveLength(3);
  });
});

describe('updater manifest contract', () => {
  const config = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');

  test('the app checks the same feed branch the pipeline publishes', () => {
    const updater = config.plugins.updater;
    expect(updater.endpoints).toHaveLength(1);
    const endpoint = new URL(updater.endpoints[0]);
    expect(endpoint.origin).toBe('https://raw.githubusercontent.com');
    expect(endpoint.pathname.endsWith('/updates/latest.json')).toBe(true);
    expect(workflow).toContain("$branch = 'updates'");
    expect(workflow).toContain("'latest.json'");
  });

  test('the endpoint repository matches the pipeline repository', () => {
    const endpoint = new URL(config.plugins.updater.endpoints[0]);
    const [, owner, repo] = endpoint.pathname.split('/');
    expect(owner).toBe('howlil');
    expect(repo).toBe('otto');
    expect(workflow).toContain('$env:GITHUB_REPOSITORY');
  });

  test('the manifest signature can be verified and installs quietly', () => {
    const updater = config.plugins.updater;
    const key = Buffer.from(updater.pubkey, 'base64').toString('utf8');
    expect(key.startsWith('untrusted comment: minisign public key')).toBe(true);
    expect(updater.windows.installMode).toBe('quiet');
  });
});
