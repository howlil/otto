import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  compareVersions,
  extractChangelogNotes,
  nextVersion,
  parseTag,
  planAutomaticVersion,
  releaseLevel,
} from '../../scripts/release-version';

describe('release version policy', () => {
  test('validates strict immutable release tags', () => {
    expect(parseTag('v0.12.3')).toEqual([0, 12, 3]);
    expect(parseTag('v1.0.0')).toEqual([1, 0, 0]);
    expect(parseTag('v0.12.3-beta.1')).toBeNull();
    expect(parseTag('v0.01.3')).toBeNull();
  });

  test('compares numerically instead of alphabetically', () => {
    expect(compareVersions([0, 10, 0], [0, 9, 12])).toBeGreaterThan(0);
    expect(compareVersions([1, 0, 0], [0, 3, 1])).toBeGreaterThan(0);
  });

  test('skips changes that are not user-facing', () => {
    expect(releaseLevel(['docs: update README', 'ci: update workflow'])).toBe(0);
    expect(nextVersion([0, 1, 0], 0)).toBeNull();
  });

  test('patches fixes and unknown commit subjects', () => {
    expect(releaseLevel(['fix(agent): reject stale events'])).toBe(1);
    expect(releaseLevel(['Improve reliability'])).toBe(1);
    expect(nextVersion([0, 1, 0], 1)).toBe('0.1.1');
    expect(nextVersion([1, 0, 0], 1)).toBe('1.0.1');
  });

  test('a feature dominates a fix within a batch', () => {
    expect(releaseLevel(['fix: crash', 'feat(agent): support new provider'])).toBe(2);
    expect(nextVersion([0, 9, 8], 2)).toBe('0.10.0');
    expect(nextVersion([1, 0, 4], 2)).toBe('1.1.0');
  });

  test('Windows updates remain quiet for current-user installations', () => {
    const config = JSON.parse(
      readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
    );
    expect(config.plugins.updater.windows.installMode).toBe('quiet');
    expect(config.bundle.windows.nsis.installMode).toBe('currentUser');
    expect(config.plugins.updater.endpoints).toEqual([
      'https://raw.githubusercontent.com/howlil/otto/updates/latest.json',
    ]);
  });

  test('recognizes squash and merge-commit titles and SemVer breaking bumps', () => {
    expect(releaseLevel(['Merge pull request #3 from howlil/feature\n\nfeat(agent): new feature'])).toBe(2);
    expect(releaseLevel(['feat!: change runtime contract\n\nBREAKING CHANGE: data migration'])).toBe(3);
    expect(nextVersion([0, 2, 1], 3)).toBe('0.3.0');
    expect(nextVersion([1, 2, 3], 3)).toBe('2.0.0');
  });

  test('publishes an explicit higher milestone baseline once, then increments normally', () => {
    expect(planAutomaticVersion([1, 0, 0], [0, 3, 1], 3, false)).toBe('1.0.0');
    expect(planAutomaticVersion([1, 0, 0], [0, 3, 1], 0, false)).toBeNull();
    expect(planAutomaticVersion([1, 0, 0], [1, 0, 0], 1, true)).toBe('1.0.1');
    expect(planAutomaticVersion([1, 0, 0], [1, 0, 0], 2, true)).toBe('1.1.0');
    expect(planAutomaticVersion([1, 0, 0], [1, 0, 0], 3, true)).toBe('2.0.0');
  });

  test('extracts curated release notes for the current release version from CHANGELOG.md', () => {
    const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
    const notes = extractChangelogNotes(changelog, '1.0.0');
    expect(notes).not.toBeNull();
    expect(notes).toContain('### Breaking Changes');
    expect(notes).toContain('### Added');
    expect(notes).not.toContain('[1.0.0]: https://');
    expect(extractChangelogNotes(changelog, '9.9.9')).toBeNull();
  });
});
