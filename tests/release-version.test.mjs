import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compareVersions, nextVersion, parseTag, releaseLevel } from '../scripts/release-version.mjs';

describe('release version policy', () => {
  test('validates strict immutable release tags', () => {
    expect(parseTag('v0.12.3')).toEqual([0, 12, 3]);
    expect(parseTag('v0.12.3-beta.1')).toBeNull();
    expect(parseTag('v0.01.3')).toBeNull();
  });

  test('compares numerically instead of alphabetically', () => {
    expect(compareVersions([0, 10, 0], [0, 9, 12])).toBeGreaterThan(0);
  });

  test('skips changes that are not user-facing', () => {
    expect(releaseLevel(['docs: update README', 'ci: update workflow'])).toBe(0);
    expect(nextVersion([0, 1, 0], 0)).toBeNull();
  });

  test('patches fixes and unknown commit subjects', () => {
    expect(releaseLevel(['fix(agent): reject stale events'])).toBe(1);
    expect(releaseLevel(['Improve reliability'])).toBe(1);
    expect(nextVersion([0, 1, 0], 1)).toBe('0.1.1');
  });

  test('a feature dominates a fix within a batch', () => {
    expect(releaseLevel(['fix: crash', 'feat(agent): support new provider'])).toBe(2);
    expect(nextVersion([0, 9, 8], 2)).toBe('0.10.0');
  });

  test('Windows updates remain quiet for current-user installations', () => {
    const config = JSON.parse(
      readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
    );
    expect(config.plugins.updater.windows.installMode).toBe('quiet');
    expect(config.bundle.windows.nsis.installMode).toBe('currentUser');
  });

  test('recognizes squash and merge-commit titles and pre-1.0 breaking changes', () => {
    expect(releaseLevel(['Merge pull request #3 from howlil/feature\n\nfeat(agent): new feature'])).toBe(2);
    expect(releaseLevel(['feat!: change runtime contract\n\nBREAKING CHANGE: data migration'])).toBe(2);
    expect(nextVersion([0, 2, 1], 2)).toBe('0.3.0');
  });
});
