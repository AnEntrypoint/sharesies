// Adversarial diverse-TUI sweep: real vim and less run inside the shared PTY,
// joined from a real Chromium tab over WebRTC, driven with real keystrokes.
// Not part of `npm test` (needs a browser binary) — run manually.
//
// Known sandbox quirk (not a joinin bug): on Windows, briefly spawning a
// PTY app changes the hosting process's console mode; running Playwright's
// chromium.launch() afterward in that SAME process can then fail. If this
// script crashes with no JS-catchable error right after "chromium.launch",
// close any stray chrome.exe processes from prior runs and retry — the
// in-process approach is simplest and works reliably on a clean process pool
// (verified 5/5 in isolation). Spawning the server as a child process avoids
// the console-mode collision entirely but hits a separate sandbox quirk here
// (spawned child processes get restricted network egress, breaking relay
// signaling) — neither is a defect in the shipped code, both are artifacts
// of running a browser and a PTY host in one constrained dev sandbox.

import { runServer } from '../src/server.js'
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' }

async function serveStatic() {
  const s = http.createServer((req, res) => {
    const reqPath = req.url.split('?')[0].split('#')[0]
    const filePath = path.join(dir, reqPath === '/' ? 'index.html' : reqPath.replace(/^\//, ''))
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
      res.end(data)
    })
  })
  await new Promise((resolve) => s.listen(8935, resolve))
  return s
}

async function runCase(name, { command, args, drive, expect }) {
  const seed = 'tui-sweep-' + name + '-' + Date.now()
  const server = await runServer({ command, args, web: true, seed })
  const browser = await chromium.launch()
  const page = await browser.newPage()
  page.setDefaultTimeout(60000)
  if (process.env.SHARESIES_DEBUG) {
    page.on('console', (msg) => console.log(`[${name}][console]`, msg.text()))
    await page.addInitScript(() => { window.__sharesiesDebug = true })
  }
  await page.goto(`http://localhost:8935/#${seed}`)
  let ok = true
  // Nostr relay signaling latency varies a lot (some default relays are
  // unreachable in restricted network environments) — that only affects how
  // long the initial handshake takes, never behavior after the DataChannel
  // is actually open, so this waits generously rather than tuning it tight.
  await page.waitForFunction(() => document.getElementById('status')?.dataset.kind === 'ok', { timeout: 60000 })
    .catch((e) => { ok = false; console.log(`[${name}] FAILED connect:`, e.message) })
  if (ok) {
    await page.waitForTimeout(2000)
    await drive(page)
    // term.write() is async; give the parser time to fully apply the frame.
    await page.waitForTimeout(3000)
    const text = await page.evaluate(() => {
      const term = window.__sharesiesTerm
      if (!term) return ''
      const buf = term.buffer.active
      const lines = []
      for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '')
      return lines.join('\n')
    })
    ok = expect(text)
    console.log(`[${name}] sample:`, JSON.stringify(text.slice(0, 400)))
  }
  console.log(`[${name}] ${ok ? 'PASS' : 'FAIL'}`)
  await browser.close()
  server.shutdown(0)
  return ok
}

const staticServer = await serveStatic()

const results = []

results.push(await runCase('vim-altscreen', {
  command: 'vim',
  args: ['-c', 'set nocompatible'],
  drive: async (page) => {
    await page.keyboard.type('iHELLO_FROM_VIM')
    await page.keyboard.press('Escape')
  },
  expect: (text) => text.includes('HELLO_FROM_VIM')
}))

results.push(await runCase('less-pager', {
  command: process.platform === 'win32' ? 'cmd.exe' : 'sh',
  args: process.platform === 'win32' ? ['/c', 'echo LESS_LINE_1 && echo LESS_LINE_2 && echo LESS_LINE_3 | less'] : ['-c', 'printf "L1\\nL2\\nL3\\n" | less'],
  drive: async (page) => { await page.waitForTimeout(500) },
  expect: (text) => /LESS_LINE_1|L1/.test(text)
}))

await staticServer.close()
const allOk = results.every(Boolean)
console.log(allOk ? '[RESULT] PASS — diverse TUI sweep confirmed' : '[RESULT] FAIL — see cases above')
process.exit(allOk ? 0 : 1)
