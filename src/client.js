// Client side: join one or more shared sessions created by friends.
//
// `npx github:AnEntrypoint/sharesies --connect <seed> [<seed> ...]` derives the same keypair each
// server used, connects over HyperDHT, and mirrors the shared PTY into your
// terminal. Your keystrokes go to whichever session is in the foreground.
// Other sessions stay connected in the background, buffer their output, and
// can be switched to with Ctrl+] followed by:
//   1-9   jump to session N
//   n / p next / previous session
//   q     detach from every session
//   Ctrl+] send a literal Ctrl+] to the app

import { deriveKeyPair } from './keys.js'
import { getProtocol } from './protocol.js'

const SWITCH_KEY = 0x1d
const BACKLOG_LIMIT = 256 * 1024

function once(emitter, event) {
  return new Promise((resolve, reject) => {
    const onEvent = (value) => {
      cleanup()
      resolve(value)
    }
    const onError = (err) => {
      cleanup()
      reject(err)
    }
    const cleanup = () => {
      emitter.removeListener(event, onEvent)
      emitter.removeListener('error', onError)
    }
    emitter.once(event, onEvent)
    emitter.once('error', onError)
  })
}

function termSize() {
  return { width: process.stdout.columns || 80, height: process.stdout.rows || 24 }
}

// A bounded byte log of what a session has printed, so switching back to a
// session can replay its recent screen output.
class Backlog {
  constructor(limit) {
    this.limit = limit
    this.chunks = []
    this.size = 0
  }

  push(buf) {
    this.chunks.push(buf)
    this.size += buf.length
    while (this.size - this.chunks[0].length > this.limit) {
      this.size -= this.chunks.shift().length
    }
  }

  contents() {
    return Buffer.concat(this.chunks, this.size)
  }
}

async function connectSession(node, seed, { onStdout, onStderr, onExit }) {
  const { handshakeSpawn, resize } = await getProtocol()
  const { buffer, uint } = (await import('compact-encoding')).default ?? (await import('compact-encoding'))
  const Protomux = (await import('protomux')).default ?? (await import('protomux'))

  const { keyPair } = await deriveKeyPair(seed)
  const socket = node.connect(keyPair.publicKey, { keyPair })

  await once(socket, 'open')
  socket.setKeepAlive(5000)

  const mux = new Protomux(socket)
  let exitCode = null
  let closed = false

  const finish = () => {
    if (closed) return
    closed = true
    try { socket.end() } catch {}
    onExit(exitCode)
  }

  const channel = mux.createChannel({
    protocol: 'hypershell',
    id: null,
    handshake: handshakeSpawn,
    onopen() {},
    onclose: finish,
    messages: [
      { encoding: buffer },
      { encoding: buffer, onmessage: onStdout },
      { encoding: buffer, onmessage: onStderr },
      { encoding: uint, onmessage: (code) => { exitCode = code } },
      { encoding: resize }
    ]
  })

  channel.open({ command: '', args: [], ...termSize() })

  return {
    seed,
    send(buf) {
      try { channel.messages[0].send(buf) } catch {}
    },
    resize(width, height) {
      try { channel.messages[4].send({ width, height }) } catch {}
    },
    close() {
      try { channel.close() } catch {}
      finish()
    }
  }
}

// Ask the app to repaint: a size change of one column then back forces a
// SIGWINCH, which full-screen apps answer by redrawing their current screen.
function nudgeRedraw(session) {
  const { width, height } = termSize()
  session.resize(Math.max(1, width - 1), height)
  session.resize(width, height)
}

export async function runClient(seeds) {
  const list = Array.isArray(seeds) ? seeds : [seeds]
  const multi = list.length > 1

  // One DHT node serves every session: a single bootstrap and UDP socket
  // instead of one of each per session.
  const DHT = (await import('hyperdht')).default ?? (await import('hyperdht'))
  const node = new DHT()

  const sessions = []
  let foreground = null
  let exiting = false
  let lastExitCode = 0
  let armed = false
  let restoreStdin = () => {}

  const titleFor = (s) => `sharesies ${sessions.indexOf(s) + 1}/${sessions.length}`
  const setTitle = () => {
    if (multi && foreground) process.stdout.write(`\x1b]0;${titleFor(foreground)}\x07`)
  }

  const teardown = (code) => {
    if (exiting) return
    exiting = true
    try { restoreStdin() } catch {}
    for (const s of sessions) s.close()
    try { node.destroy() } catch {}
    process.exit(code)
  }

  const shouldExitWhenEmpty = () => {
    if (sessions.length === 0) teardown(lastExitCode)
  }

  const removeSession = (entry, code) => {
    const idx = sessions.indexOf(entry)
    if (idx === -1) return
    sessions.splice(idx, 1)
    if (code !== null && code !== undefined) lastExitCode = code
    if (foreground === entry) {
      foreground = null
      if (sessions.length) switchTo(Math.min(idx, sessions.length - 1))
    }
    if (multi && sessions.length) setTitle()
    shouldExitWhenEmpty()
  }

  const makeEntry = (seed) => {
    const entry = { seed, backlog: new Backlog(BACKLOG_LIMIT), unseen: 0, session: null }
    return entry
  }

  const onOutput = (entry) => (d) => {
    entry.backlog.push(d)
    if (entry === foreground) process.stdout.write(d)
    else {
      entry.unseen += 1
      if (multi) process.stdout.write(`\x1b]0;${titleFor(foreground)} [${entry.unseen} new in ${sessions.indexOf(entry) + 1}]\x07`)
    }
  }

  const switchTo = (index) => {
    if (sessions.length === 0) return
    const next = sessions[((index % sessions.length) + sessions.length) % sessions.length]
    if (next === foreground) return
    foreground = next
    next.unseen = 0
    process.stdout.write('\x1b[2J\x1b[H')
    process.stdout.write(next.backlog.contents())
    if (next.session) nudgeRedraw(next.session)
    setTitle()
  }

  const attach = async (seed) => {
    const entry = makeEntry(seed)
    const session = await connectSession(node, seed, {
      onStdout: onOutput(entry),
      onStderr: (d) => process.stderr.write(d),
      onExit: (code) => removeSession(entry, code)
    })
    entry.session = session
    // Sessions connect in whatever order the network answers, but Ctrl+] 1..9
    // and the initial foreground follow the order the seeds were given.
    sessions.push(entry)
    sessions.sort((a, b) => list.indexOf(a.seed) - list.indexOf(b.seed))
    if (!foreground) switchTo(0)
    else setTitle()
    return entry
  }

  const handleInput = (d) => {
    let start = 0
    for (let i = 0; i < d.length; i++) {
      if (armed) {
        armed = false
        const b = d[i]
        if (b >= 0x31 && b <= 0x39) {
          if (start < i - 1) forward(d.subarray(start, i - 1))
          if (b - 0x31 < sessions.length) switchTo(b - 0x31)
          start = i + 1
        } else if (b === 0x6e || b === 0x70) { // n / p
          if (start < i - 1) forward(d.subarray(start, i - 1))
          switchTo(sessions.indexOf(foreground) + (b === 0x6e ? 1 : -1))
          start = i + 1
        } else if (b === 0x71) { // q
          teardown(0)
          return
        } else if (b === SWITCH_KEY) {
          // Literal Ctrl+]: this byte starts the next forwarded run.
          start = i
        } else {
          start = i
        }
      } else if (d[i] === SWITCH_KEY) {
        if (start < i) forward(d.subarray(start, i))
        armed = true
        start = i + 1
      }
    }
    if (!armed && start < d.length) forward(d.subarray(start))
  }

  const forward = (buf) => {
    if (foreground && foreground.session) foreground.session.send(buf)
  }

  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  const wasRaw = process.stdin.isTTY
  restoreStdin = () => {
    if (wasRaw && process.stdin.isTTY) process.stdin.setRawMode(false)
    process.stdin.pause()
    process.stdin.removeAllListeners('data')
  }

  process.stdin.on('data', handleInput)
  process.stdin.resume()

  process.stdout.on('resize', () => {
    if (foreground && foreground.session) {
      const { width, height } = termSize()
      foreground.session.resize(width, height)
    }
  })

  process.on('SIGINT', () => teardown(130))

  const results = await Promise.allSettled(list.map(attach))
  // Once every attach has settled, the first seed on the command line is in front.
  if (sessions.length) switchTo(0)
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length === results.length) {
    throw failed[0].reason
  }
  for (const f of failed) {
    process.stderr.write(`sharesies: could not join a session: ${f.reason && f.reason.message ? f.reason.message : f.reason}\n`)
  }

  return { sessions, switchTo, teardown }
}
