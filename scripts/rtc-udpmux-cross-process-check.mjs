// Adversarial witness: is enableIceUdpMux specifically a same-process
// self-connection artifact, or does it also break real cross-process peers?
// Spawns two separate Node processes (a real cross-process scenario, unlike
// the same-process test that first surfaced the bug) and checks whether they
// connect with --mux vs without.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const workerPath = path.join(dir, 'rtc-udpmux-worker.mjs')

function runPair(namespace, muxFlag) {
  return new Promise((resolve) => {
    const host = spawn(process.execPath, [workerPath, namespace, 'host', muxFlag], { cwd: path.join(dir, '..') })
    const guest = spawn(process.execPath, [workerPath, namespace, 'guest', muxFlag], { cwd: path.join(dir, '..') })
    let passed = false
    const onLine = (proc, label) => (data) => {
      const text = data.toString()
      process.stdout.write(`[${label}] ${text}`)
      if (text.includes('RESULT PASS')) passed = true
    }
    host.stdout.on('data', onLine(host, 'host'))
    guest.stdout.on('data', onLine(guest, 'guest'))
    host.stderr.on('data', (d) => process.stdout.write(`[host err] ${d}`))
    guest.stderr.on('data', (d) => process.stdout.write(`[guest err] ${d}`))
    setTimeout(() => {
      host.kill(); guest.kill()
      resolve(passed)
    }, 26000)
  })
}

const namespace = 'cross-process-' + Date.now()
console.log('=== without udpMux ===')
const noMuxOk = await runPair(namespace + '-nomux', 'nomux')
console.log('=== with udpMux ===')
const muxOk = await runPair(namespace + '-mux', 'mux')

console.log('[SUMMARY] no-mux cross-process:', noMuxOk ? 'PASS' : 'FAIL')
console.log('[SUMMARY] mux cross-process:', muxOk ? 'PASS' : 'FAIL')
process.exit(noMuxOk ? 0 : 1)
