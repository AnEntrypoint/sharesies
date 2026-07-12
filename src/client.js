// Client side: join a shared session created by a friend.
//
// `npx joinin --connect <seed>` derives the same keypair the server used,
// connects over HyperDHT, and mirrors the shared PTY into your terminal. Your
// keystrokes go to the same PTY everyone else is typing into. Multiple friends
// can each run this and share one live session.

import { deriveKeyPair } from './keys.js'
import { getProtocol } from './protocol.js'

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

export async function runClient(seed) {
  const { handshakeSpawn, resize } = await getProtocol()
  const { buffer, uint } = (await import('compact-encoding')).default ?? (await import('compact-encoding'))
  const Protomux = (await import('protomux')).default ?? (await import('protomux'))
  const DHT = (await import('hyperdht')).default ?? (await import('hyperdht'))

  const { keyPair } = await deriveKeyPair(seed)
  const node = new DHT()
  const socket = node.connect(keyPair.publicKey, { keyPair })

  await once(socket, 'open')
  socket.setKeepAlive(5000)

  const mux = new Protomux(socket)

  let restoreStdin = () => {}
  let exited = false

  const channel = mux.createChannel({
    protocol: 'hypershell',
    id: null,
    handshake: handshakeSpawn,
    onopen() {},
    onclose() {
      try {
        restoreStdin()
      } catch {}
      try {
        socket.end()
      } catch {}
      try {
        node.destroy()
      } catch {}
      if (!exited) process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0)
    },
    messages: [
      { encoding: buffer },
      { encoding: buffer, onmessage: (d) => process.stdout.write(d) },
      { encoding: buffer, onmessage: (d) => process.stderr.write(d) },
      { encoding: uint, onmessage: (code) => { process.exitCode = code } },
      { encoding: resize }
    ]
  })

  channel.open({
    command: '',
    args: [],
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24
  })

  const wasRaw = process.stdin.isTTY
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.on('data', (d) => {
    try {
      channel.messages[0].send(d)
    } catch {}
  })
  process.stdin.resume()

  process.stdout.on('resize', () => {
    try {
      channel.messages[4].send({
        width: process.stdout.columns || 80,
        height: process.stdout.rows || 24
      })
    } catch {}
  })

  restoreStdin = () => {
    if (wasRaw && process.stdin.isTTY) process.stdin.setRawMode(false)
    process.stdin.pause()
    process.stdin.removeAllListeners('data')
  }

  process.on('SIGINT', () => {
    try {
      restoreStdin()
    } catch {}
    try {
      channel.close()
    } catch {}
    exited = true
    process.exit(130)
  })

  return { node, socket, channel }
}
