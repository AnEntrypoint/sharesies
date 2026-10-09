// Server side: run a single app in the current terminal and share it.
//
// `npx github:AnEntrypoint/sharesies <app>` picks a fresh random seed, spawns
// THAT app directly (no shell wrapper), mirrors it to your own terminal, and
// advertises the session on HyperDHT. Every connecting friend joins the SAME
// session — they see the same view and can type too. When the app exits the
// whole thing closes. Pass `--shell` to share your login shell instead.

import os from 'node:os'
import { deriveKeyPair, randomSeed } from './keys.js'
import { getProtocol } from './protocol.js'
import { createSharedSession } from './session.js'
import { attachRtcTransport } from './rtc-server.js'

// The command a friend runs to join. sharesies is not on the npm registry (an
// unrelated package named `sharesies` is), so invites must name the GitHub repo.
export const RUN_COMMAND = 'npx github:AnEntrypoint/sharesies'

export function defaultShell() {
  if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe'
  return process.env.SHELL || 'bash'
}

export async function runServer(opts = {}) {
  if (!opts.command) {
    throw new Error('runServer requires opts.command — the specific app to share')
  }
  const { handshakeSpawn, resize } = await getProtocol()
  const { buffer, uint } = (await import('compact-encoding')).default ?? (await import('compact-encoding'))
  const HypercoreId = (await import('hypercore-id-encoding')).default ?? (await import('hypercore-id-encoding'))
  const Protomux = (await import('protomux')).default ?? (await import('protomux'))
  const DHT = (await import('hyperdht')).default ?? (await import('hyperdht'))

  const seed = opts.seed || randomSeed()
  const command = opts.command
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

  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
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

  const publicKey = HypercoreId.encode(keyPair.publicKey)
  const showCommand = () => `${RUN_COMMAND} --connect ${seed}`

  // Spawn the PTY only once every transport that should receive its initial
  // draw is ready to accept connections. A late-joining client only ever
  // sees the *live* stream (no replay/history), so if the PTY started first,
  // anyone still negotiating a connection — RTC's ICE handshake in
  // particular routinely takes seconds — would silently miss the app's
  // startup screen.
  let rtc = null
  if (opts.web) {
    try {
      rtc = await attachRtcTransport(session, {
        seed,
        portRangeBegin: opts.rtcPortRangeBegin,
        portRangeEnd: opts.rtcPortRangeEnd,
        proxy: opts.rtcProxy,
        udpMux: opts.rtcUdpMux,
        onPeerConnected: (peerPubkey, desc) => {
          const path = desc.relayed ? 'via TURN relay' : `direct (${desc.localType}/${desc.remoteType})`
          console.log(`sharesies: browser peer ${peerPubkey.slice(0, 12)} connected ${path}`)
        }
      })
    } catch (err) {
      console.error('sharesies: --web failed to start RTC transport: ' + (err && err.message ? err.message : err))
    }
  }

  session.start()

  const webBase = opts.webBase || 'https://anentrypoint.github.io/sharesies/'
  const showWebUrl = () => `${webBase}#${seed}`

  console.log('')
  console.log('sharesies — sharing a terminal session over HyperDHT')
  console.log('------------------------------------------------------')
  console.log('App:     ' + (args.length ? `${command} ${args.join(' ')}` : command))
  console.log('Public:  ' + publicKey)
  console.log('')
  console.log('Give a friend this command to join the SAME session:')
  console.log('')
  console.log('  ' + showCommand())
  if (rtc) {
    console.log('')
    console.log('Or, from a browser (WebRTC, no install):')
    console.log('')
    console.log('  ' + showWebUrl())
  }
  console.log('')
  console.log('Anyone with that command sees the same screen and can type.')
  console.log('The session ends when the app exits. Ctrl+C closes sharesies.')
  console.log('')

  let closed = false
  async function shutdown(code = 0) {
    if (closed) return
    closed = true
    if (localTTY && process.stdin.setRawMode) process.stdin.setRawMode(false)
    if (rtc) {
      await Promise.race([rtc.close(), new Promise((resolve) => setTimeout(resolve, 1500))]).catch(() => {})
    }
    // End the client sockets cleanly so they see a close now, rather than
    // waiting on a keepalive timeout after this process has gone.
    for (const socket of sockets) {
      try {
        socket.end()
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
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
    // Raw mode so each keystroke reaches the app immediately, instead of the
    // terminal line-buffering it until Enter.
    if (process.stdin.setRawMode) process.stdin.setRawMode(true)
    process.stdin.on('data', (d) => {
      // Ctrl+C closes sharesies (as the banner says), so it is not forwarded.
      const i = d.indexOf(0x03)
      if (i === -1) return session.write(d)
      if (i > 0) session.write(d.subarray(0, i))
      shutdown(130)
    })
    process.stdout.on('resize', () => {
      session.resize(process.stdout.columns || 80, process.stdout.rows || 24)
    })
  }

  return { node, server, session, keyPair, publicKey, seed, shutdown }
}
