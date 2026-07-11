// Browser client: joins a sharesies session over WebRTC and mirrors the
// shared PTY into an xterm.js terminal ("wterm" — the stable web-terminal
// surface). Handles diverse full-screen TUIs (alt-screen, cursor movement,
// colors) via xterm's VT100/xterm emulation, plus resize fan-out, bracketed
// paste, and reconnect-visible state.

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { createRtcTransport, deriveRoomFromSeed } from './rtc-browser.js'
import { FRAME, encodeFrame, decodeFrame } from '../../src/rtc-protocol.js'

const statusEl = document.getElementById('status')
const termEl = document.getElementById('terminal')
const formEl = document.getElementById('join-form')
const seedInputEl = document.getElementById('seed-input')

function setStatus(text, kind = 'info') {
  statusEl.textContent = text
  statusEl.dataset.kind = kind
}

function seedFromLocation() {
  const hash = location.hash.replace(/^#/, '')
  if (hash) return decodeURIComponent(hash)
  const params = new URLSearchParams(location.search)
  return params.get('key') || params.get('seed') || ''
}

async function joinSession(seed) {
  const term = new Terminal({
    scrollback: 5000,
    convertEol: false,
    cursorBlink: true,
    allowProposedApi: true,
    fontFamily: 'Menlo, Consolas, monospace',
    fontSize: 14
  })
  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(termEl)
  fitAddon.fit()
  term.writeln('sharesies — connecting…')

  const { session } = createRtcTransport({ namespace: 'sharesies' })
  const roomId = await deriveRoomFromSeed(seed)

  let hostPeer = null
  let connected = false

  const send = (peerPubkey, type, payload) => {
    session.send(peerPubkey, encodeFrame(type, payload))
  }

  session.addEventListener('peer-open', (e) => {
    hostPeer = e.detail.peerPubkey
    connected = true
    setStatus('Connected', 'ok')
    term.clear()
    term.focus()
    send(hostPeer, FRAME.RESIZE, { width: term.cols, height: term.rows })
  })

  session.addEventListener('peer-close', () => {
    connected = false
    setStatus('Disconnected — reconnecting…', 'warn')
  })

  session.addEventListener('peer-error', () => {
    setStatus('Connection error — retrying…', 'error')
  })

  session.addEventListener('error', (e) => {
    setStatus('Error: ' + (e.detail?.message || 'unknown'), 'error')
  })

  session.addEventListener('data', (e) => {
    const frame = decodeFrame(e.detail.data)
    if (!frame) return
    if (frame.type === FRAME.STDOUT || frame.type === FRAME.STDERR) {
      term.write(frame.payload)
    } else if (frame.type === FRAME.EXIT) {
      term.writeln('')
      term.writeln('[sharesies] session ended (exit code ' + frame.payload + ')')
      connected = false
      setStatus('Session ended', 'info')
    }
  })

  term.onData((data) => {
    if (!connected || !hostPeer) return
    send(hostPeer, FRAME.STDIN, new TextEncoder().encode(data))
  })

  const ro = new ResizeObserver(() => {
    fitAddon.fit()
    if (connected && hostPeer) send(hostPeer, FRAME.RESIZE, { width: term.cols, height: term.rows })
  })
  ro.observe(termEl)

  setStatus('Finding host…', 'info')
  await session.connect(roomId, { displayName: 'guest' })
}

formEl.addEventListener('submit', (ev) => {
  ev.preventDefault()
  const seed = seedInputEl.value.trim()
  if (!seed) return
  location.hash = encodeURIComponent(seed)
  startFromSeed(seed)
})

function startFromSeed(seed) {
  formEl.hidden = true
  termEl.hidden = false
  joinSession(seed).catch((err) => {
    setStatus('Failed to join: ' + (err && err.message ? err.message : err), 'error')
  })
}

const initialSeed = seedFromLocation()
if (initialSeed) {
  seedInputEl.value = initialSeed
  startFromSeed(initialSeed)
} else {
  setStatus('Paste an invite seed to join a session', 'info')
}
