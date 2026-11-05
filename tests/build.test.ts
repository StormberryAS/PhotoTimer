// The build: the committed app.js is what ts/app.ts compiles to, and the only JavaScript in the
// repository is that compiled output plus the generator output cities.js, both marked
// linguist-generated, and the vendored SunCalc 1.8.0, marked linguist-vendored (Marcos,
// 2026-10-17: no hand-written JavaScript). cities.js is written by SunApp's update_cities.py and
// suncalc.js is copied in from mourner/suncalc; both are held byte for byte and never edited here.
// When update_cities.py writes a new catalogue, update its hash below in the same commit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const COMPILED = ['app.js'];
/** The generator output, by sha256, as at c6691e3 (the same file as SunApp's, byte for byte). */
const GENERATED: Record<string, string> = {
  'cities.js': '2f08782c7f41df5eb95c15a4a668a389505bd4bfba059040d048cbc1324afce2',
};
/** SunCalc 1.8.0 exactly as vendored in SunApp and the other Labs repositories (sha256 of suncalc.js). */
const VENDORED: Record<string, string> = {
  'suncalc.js': 'e17fa013a5ab354c22844f3cebecd4a2b866518e5b63d132d537ea6578cb217b',
};

test('tools/build-ts.sh --check passes: app.js equals a fresh compile', () => {
  const out = execFileSync(`${root}tools/build-ts.sh`, ['--check'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(out, /^build-ts: app\.js matches ts\/app\.ts$/m);
  assert.match(out, /^build-ts: check passed$/m);
});

test('the generated cities.js and the vendored SunCalc 1.8.0 are unchanged, byte for byte', () => {
  for (const [f, sha] of Object.entries({ ...GENERATED, ...VENDORED })) {
    assert.equal(createHash('sha256').update(readFileSync(`${root}${f}`)).digest('hex'), sha, f);
  }
  assert.match(readFileSync(`${root}cities.js`, 'utf8'), /^\/\/ Stormberry Labs shared city catalogue\.\n\/\/ GENERATED FILE, DO NOT EDIT BY HAND\.\n/);
  assert.match(readFileSync(`${root}suncalc.js`, 'utf8'), /^\/\* SunCalc 1\.8\.0 /);
});

test('the only JavaScript is compiled, generated or vendored, each file marked so', (t) => {
  const git = (...args: string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  let inGit = false;
  try { inGit = git('rev-parse', '--is-inside-work-tree').trim() === 'true'; } catch { inGit = false; }
  if (!inGit) { t.skip('not a git checkout'); return; }
  const js = git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.js', '*.mjs', '*.cjs').split('\0').filter(Boolean);
  const vendored = Object.keys(VENDORED);
  const generated = [...COMPILED, ...Object.keys(GENERATED)];
  assert.deepEqual([...new Set(js)].sort(), [...generated, ...vendored].sort());
  for (const f of generated) assert.equal(git('check-attr', 'linguist-generated', '--', f).trim(), `${f}: linguist-generated: true`);
  for (const f of vendored) assert.equal(git('check-attr', 'linguist-vendored', '--', f).trim(), `${f}: linguist-vendored: true`);
});
