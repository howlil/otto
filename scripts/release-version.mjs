import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function parseTag(tag) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function releaseLevel(messages) {
  let highest = 0;
  for (const message of messages) {
    const lines = message.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const line = lines[0]?.startsWith('Merge pull request')
      ? lines.slice(1).find((entry) => /^(feat|fix|perf|docs|chore|build|ci|test|refactor|style|revert)(\([^)]+\))?!?:/.test(entry))
      : lines[0];
    if (!line) {
      highest = Math.max(highest, 1);
      continue;
    }
    const conventional = /^(feat|fix|perf|docs|chore|build|ci|test|refactor|style|revert)(\([^)]+\))?(!)?:/.exec(line);
    if (!conventional) {
      highest = Math.max(highest, 1);
      continue;
    }
    if (conventional[3] || /(^|\n)BREAKING CHANGE:/m.test(message)) {
      highest = Math.max(highest, 2);
    } else if (conventional[1] === 'feat') {
      highest = Math.max(highest, 2);
    } else if (['fix', 'perf', 'revert'].includes(conventional[1])) {
      highest = Math.max(highest, 1);
    }
  }
  return highest;
}

export function nextVersion(base, level) {
  if (level === 0) return null;
  if (level === 2) return [base[0], base[1] + 1, 0].join('.');
  return [base[0], base[1], base[2] + 1].join('.');
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function readBaseline() {
  const p = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const t = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version;
  const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!p || p !== t || p !== cargo || !/^\d+\.\d+\.\d+$/.test(p)) {
    throw new Error('Source versions must match before generating a release');
  }
  return p.split('.').map(Number);
}

function plan() {
  const baseline = readBaseline();
  const candidates = git('tag', '--list', 'v*').split(/\r?\n/).filter(Boolean)
    .map((tag) => ({ tag, version: parseTag(tag) }))
    .filter((entry) => entry.version)
    .filter((entry) => {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', entry.tag, 'HEAD'], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })
    .sort((a, b) => compareVersions(b.version, a.version));
  const latest = candidates[0] || null;
  const base = latest && compareVersions(latest.version, baseline) >= 0 ? latest.version : baseline;
  const range = latest ? latest.tag + '..HEAD' : 'HEAD';
  const messages = git('log', '--format=%B%x00', range).split('\0').map((value) => value.trim()).filter(Boolean);
  const version = nextVersion(base, releaseLevel(messages));
  const output = 'publish=' + (version ? 'true' : 'false') + '\n'
    + 'version=' + (version || '') + '\n'
    + 'previous_tag=' + (latest?.tag || '') + '\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}

function stamp(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Invalid release version');
  readBaseline();
  const path = 'src-tauri/tauri.conf.json';
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.version = version;
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'plan') plan();
  else if (command === 'stamp') stamp(process.argv[3]);
  else throw new Error('Expected plan or stamp');
}
