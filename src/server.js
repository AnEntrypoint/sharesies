// Server side: run a single app in the current terminal and share it.
//
// With no parameters `npx sharesies` picks a fresh random seed, spawns the
// default shell (or the app you name), mirrors it to your own terminal, and
// advertises the session on HyperDHT. Every connecting friend joins the SAME
// session — they see the same view and can type too. When the app exits the
// whole thing closes.

import os from 'node:os'
import { deriveKeyPair, randomSeed } from './keys.js'
import { getProtocol } from './protocol.js'
import { createSharedSession } from './session.js'

function defaultShell() {
  if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe'
  return process.env.SHELL || 'bash'
}

export async function runServer(opts = {}) {
  const { handshakeSpawn, resize } = await getProtocol()
  const { buffer, uint } = (await import('compact-encoding')).default ?? (await import('compact-encoding'))
  const HypercoreId = (await import('hypercore-id-encoding')).default ?? (await import('hypercore-id-encoding'))
  const Protomux = (await import('protomux')).default ?? (await import('protomux'))
  const DHT = (await import('hyperdht')).default ?? (await import('hyperdht'))

  const seed = opts.seed || randomSeed()
  const command = opts.command || defaultShell()
  const args = opts.args && opts.args.length ? opts.args : []
  const localTTY = !!process.stdout.isTTY

  const { keyPair } = await deriveKeyPair(seed)
  const node = new DHT()
  const server = node.createServer({ firewall: () => false })

  const width = process.stdout.columns || 80
  const height = process.stdout.rows || 24

  const session = createSharedSession({
    command,
    args,
    cwd: opts.cwd || os.homedir(),
    env: process.env,
    width,
    height,
    localTTY
  })

  server.on('connection', (socket) => {
    socket.on('error', (err) => {
      if (err.code !== 'ECONNRESET' && err.code !== 'ETIMEDOUT') console.error('connection error:', err.message)
    })
    socket.setKeepAlive(5000)

    const mux = new Protomux(socket)
    const client = { channel: null }

    client.channel = mux.createChannel({
      protocol: 'hypershell',
      id: null,
      handshake: handshakeSpawn,
      onopen(handshake) {
        session.addClient(client)
        // Honour the connecting client's initial terminal size.
        if (handshake && handshake.width && handshake.height) {
          session.resize(handshake.width, handshake.height, client)
        }
      },
      onclose() {
        session.removeClient(client)
      },
      messages: [
        { encoding: buffer, onmessage: (d) => session.write(d) },
        { encoding: buffer },
        { encoding: buffer },
        { encoding: uint },
        { encoding: resize, onmessage: (r) => session.resize(r.width, r.height, client) }
      ]
    })

    client.channel.open({ width, height })
  })

  await server.listen(keyPair)
  session.start()

  const publicKey = HypercoreId.encode(keyPair.publicKey)
  const showCommand = (c) => `npx sharesies --connect ${seed}`

  console.log('')
  console.log('sharesies — sharing a terminal session over HyperDHT')
  console.log('------------------------------------------------------')
  console.log('App:     ' + (args.length ? `${command} ${args.join(' ')}` : command))
  console.log('Public:  ' + publicKey)
  console.log('')
  console.log('Give a friend this command to join the SAME session:')
  console.log('')
  console.log('  ' + showCommand())
  console.log('')
  console.log('Anyone with that command sees the same screen and can type.')
  console.log('The session ends when the app exits. Ctrl+C closes sharesies.')
  console.log('')

  let closed = false
  function shutdown(code = 0) {
    if (closed) return
    closed = true
    try {
      session.destroy()
    } catch {}
    try {
      server.close()
    } catch {}
    try {
      node.destroy()
    } catch {}
    process.exit(typeof code === 'number' ? code : 0)
  }

  session.onAppExit((code) => shutdown(code))
  process.on('SIGINT', () => shutdown(130))
  process.on('SIGTERM', () => shutdown(143))

  if (localTTY) {
    process.stdin.on('data', (d) => session.write(d))
    process.stdout.on('resize', () => {
      session.resize(process.stdout.columns || 80, process.stdout.rows || 24)
    })
  }

  return { node, server, session, keyPair, publicKey, seed, shutdown }
}
