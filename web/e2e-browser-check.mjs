// One-shot adversarial witness: a real Chromium tab loads the actual
// web/index.html + bundle.js, joins a live joinin --web session over real
// WebRTC, types a command, and the output must appear in the real xterm.js
// DOM. Not part of `npm test` (needs a browser binary) — run manually via
// `node web/e2e-browser-check.mjs`.

import { runServer } from '../src/server.js'
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' }

const staticServer = http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0].split('#')[0]
  const filePath = path.join(dir, reqPath === '/' ? 'index.html' : reqPath.replace(/^\//, ''))
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
    res.end(data)
  })
})
await new Promise((resolve) => staticServer.listen(8934, resolve))
console.log('[test] static server up on :8934')

const seed = 'browser-e2e-' + Date.now()
const server = await runServer({
  command: process.platform === 'win32' ? 'cmd.exe' : 'sh',
  args: process.platform === 'win32' ? ['/k'] : [],
  web: true,
  seed
})
console.log('[test] joinin server up, publicKey', server.publicKey.slice(0, 12))

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (msg) => console.log('[browser console]', msg.text()))
page.on('pageerror', (err) => console.log('[browser pageerror]', err.message))

await page.goto(`http://localhost:8934/#${seed}`)
console.log('[test] page loaded, waiting for connection...')

let ok = true
await page.waitForFunction(
  () => document.getElementById('status')?.dataset.kind === 'ok',
  { timeout: 30000 }
).catch((e) => { ok = false; console.log('[test] FAILED waiting for connected status:', e.message) })

// xterm renders to <canvas>, so DOM text is not a valid read of terminal
// content — use the real buffer API exposed as window.__sharesiesTerm.
const readTerminalText = () => page.evaluate(() => {
  const term = window.__sharesiesTerm
  if (!term) return ''
  const buf = term.buffer.active
  const lines = []
  for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '')
  return lines.join('\n')
})

if (ok) {
  console.log('[test] browser status = ok (WebRTC peer connected)')
  await page.keyboard.type('echo BROWSER_E2E_MARKER')
  await page.keyboard.press('Enter')

  ok = await page.waitForFunction(
    () => {
      const term = window.__sharesiesTerm
      if (!term) return false
      const buf = term.buffer.active
      for (let i = 0; i < buf.length; i++) {
        if (buf.getLine(i)?.translateToString(true).includes('BROWSER_E2E_MARKER')) return true
      }
      return false
    },
    { timeout: 15000 }
  ).then(() => true).catch(() => false)
}

const termText = await readTerminalText().catch(() => '')
console.log('[test] terminal text sample:', JSON.stringify(termText.slice(-300)))
console.log(ok ? '[RESULT] PASS — real Chromium client rendered live PTY output over WebRTC' : '[RESULT] FAIL')

await browser.close()
staticServer.close()
server.shutdown(0)
process.exit(ok ? 0 : 1)
