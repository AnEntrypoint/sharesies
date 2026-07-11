// Server-side RTC transport: joins the same shared session as an additional
// peer type, reachable over WebRTC (via wireweave) instead of HyperDHT.
//
// SharedSession (src/session.js) only requires a "client" to look like
// `{ channel: { messages: [ {send}, {send}, {send}, {send}, {send} ] } }` and
// `channel.close()`. This file wraps a wireweave DataSession peer to expose
// exactly that shape, so session.js is unmodified and both transports fan out
// identically. A single RTCDataChannel per peer carries all five logical
// streams multiplexed with the frame envelope in rtc-protocol.js.

import { createRtcTransport, deriveRoomFromSeed } from './rtc-node.js'
import { FRAME, encodeFrame, decodeFrame } from './rtc-protocol.js'

export function makeRtcClient(peerPubkey, session) {
  const send = (type, payload) => {
    const frame = encodeFrame(type, payload)
    session.send(peerPubkey, frame)
  }
  return {
    peerPubkey,
    channel: {
      messages: [
        { send: () => {} }, // [0] stdin — inbound only on the server side
        { send: (d) => send(FRAME.STDOUT, d) },
        { send: (d) => send(FRAME.STDERR, d) },
        { send: (code) => send(FRAME.EXIT, code) },
        { send: (r) => send(FRAME.RESIZE, r) }
      ],
      close() {
        // peer-close is driven by the DataSession lifecycle, not initiated here
      }
    }
  }
}

// Wires a wireweave DataSession's peer lifecycle/data events onto a
// SharedSession, fanning RTC peers in/out exactly like HyperDHT clients. Pure
// event wiring — no networking — so it is unit-testable with a mock
// EventTarget-based session standing in for a real DataSession.
export function wireRtcTransport(sharedSession, session) {
  const clients = new Map()

  session.addEventListener('peer-open', (e) => {
    const peerPubkey = e.detail.peerPubkey
    const client = makeRtcClient(peerPubkey, session)
    clients.set(peerPubkey, client)
    sharedSession.addClient(client)
  })

  session.addEventListener('peer-close', (e) => {
    const client = clients.get(e.detail.peerPubkey)
    if (client) {
      sharedSession.removeClient(client)
      clients.delete(e.detail.peerPubkey)
    }
  })

  session.addEventListener('data', (e) => {
    const frame = decodeFrame(e.detail.data)
    if (!frame) return
    if (frame.type === FRAME.STDIN) sharedSession.write(Buffer.from(frame.payload))
    else if (frame.type === FRAME.RESIZE) {
      const client = clients.get(e.detail.peerPubkey)
      sharedSession.resize(frame.payload.width, frame.payload.height, client)
    }
  })

  return clients
}

// Attaches an RTC (wireweave) join point to an already-running SharedSession.
// `seed` is the same invite seed used for the HyperDHT keypair; the RTC room
// id is derived from it so one invite reaches both transports.
export async function attachRtcTransport(sharedSession, { seed, namespace = 'sharesies' } = {}) {
  const { session, relayPool, auth } = await createRtcTransport({ namespace })
  const roomId = deriveRoomFromSeed(seed)
  const clients = wireRtcTransport(sharedSession, session)

  await session.connect(roomId, { displayName: 'host' })

  return {
    roomId,
    pubkey: auth.pubkey,
    async close() {
      for (const client of clients.values()) sharedSession.removeClient(client)
      clients.clear()
      await session.disconnect().catch(() => {})
      relayPool.disconnect()
    }
  }
}
