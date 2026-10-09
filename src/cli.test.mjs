import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../sharesies.mjs', import.meta.url))

// npx and bunx start the bin through a symlink in node_modules/.bin. The CLI
// must still run then, or `npx github:AnEntrypoint/sharesies` silently does nothing.
test('bin launched through a symlink (how npx runs it) prints help', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sharesies-bin-'))
  const link = path.join(dir, 'sharesies')
  symlinkSync(entry, link)
  const r = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /realtime shared TUI/)
})

test('--connect with no seed fails with usage instead of joining', () => {
  const r = spawnSync(process.execPath, [entry, '--connect'], { encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /needs a seed/)
})
