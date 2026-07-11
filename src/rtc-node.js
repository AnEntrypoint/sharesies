// Node-side wireweave bootstrap.
//
// wireweave's DataSession expects a browser: global RTCPeerConnection /
// RTCSessionDescription / RTCIceCandidate, and NostrAuth expects a storage
// adapter ({getItem,setItem,removeItem}) plus WebSocket for relay connections.
// This installs all of that for Node using node-datachannel's WebRTC polyfill,
// an in-memory storage shim, and the `ws` package — so the same DataSession
// class the browser client uses also runs, unmodified, inside the CLI server.

import { createHash } from 'node:crypto'

let installed = false

export async function installRtcGlobals() {
  if (installed) return
  const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } =
    (await import('node-datachannel/polyfill'))
  if (typeof globalThis.RTCPeerConnection === 'undefined') globalThis.RTCPeerConnection = RTCPeerConnection
  if (typeof globalThis.RTCSessionDescription === 'undefined') globalThis.RTCSessionDescription = RTCSessionDescription
  if (typeof globalThis.RTCIceCandidate === 'undefined') globalThis.RTCIceCandidate = RTCIceCandidate
  installed = true
}

// Ephemeral, in-memory only — never touches disk. A fresh nostr identity per
// server process, used only to sign WebRTC/presence signaling events.
export function createMemoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v) },
    removeItem: (k) => { map.delete(k) }
  }
}

// The HyperDHT transport derives a keypair from sha256(seed). The RTC
// transport derives a room id the same deterministic way, so one shared
// seed string is a single invite for both transports at once.
export function deriveRoomFromSeed(seed) {
  return createHash('sha256').update('sharesies:' + String(seed)).digest('hex').slice(0, 32)
}

// Minimal wireweave surface: just RelayPool (signaling transport), NostrAuth
// (ephemeral signing identity) and DataSession (the actual RTCDataChannel).
// The full createWireweave() also wires up chat/channels/roles/servers, which
// sharesies has no use for.
export async function createRtcTransport({ namespace = 'sharesies' } = {}) {
  await installRtcGlobals()
  const [
    { RelayPool, NostrAuth, createDataSession, createFSM },
    NostrTools,
    XState,
    { WebSocket }
  ] = await Promise.all([
    import('wireweave'),
    import('nostr-tools'),
    import('xstate'),
    import('ws')
  ])

  const storage = createMemoryStorage()
  const auth = new NostrAuth({ nostrTools: NostrTools, storage, extension: null })
  auth.generateKey()

  const relayPool = new RelayPool({ verifyEvent: NostrTools.verifyEvent, WebSocketImpl: WebSocket })
  relayPool.connect()

  const fsm = createFSM(XState)
  const session = createDataSession({ fsm, xstate: XState, relayPool, auth, namespace })

  return { session, relayPool, auth }
}
