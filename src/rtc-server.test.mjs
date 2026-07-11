import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wireRtcTransport, makeRtcClient } from './rtc-server.js'
import { FRAME, encodeFrame } from './rtc-protocol.js'

// Mirrors wireweave's DataSession public event surface (EventTarget +
// send/broadcast) without any real WebRTC/nostr networking.
class MockDataSession extends EventTarget {
  constructor() {
    super()
    this.sent = []
  }
  send(peerPubkey, payload) {
    this.sent.push({ peerPubkey, payload })
    return true
  }
  emitPeerOpen(peerPubkey) {
    this.dispatchEvent(new CustomEvent('peer-open', { detail: { peerPubkey } }))
  }
  emitPeerClose(peerPubkey) {
    this.dispatchEvent(new CustomEvent('peer-close', { detail: { peerPubkey } }))
  }
  emitData(peerPubkey, data) {
    this.dispatchEvent(new CustomEvent('data', { detail: { peerPubkey, data } }))
  }
}

function makeMockSharedSession() {
  return {
    added: [],
    removed: [],
    written: [],
    resizes: [],
    addClient(c) { this.added.push(c) },
    removeClient(c) { this.removed.push(c) },
    write(buf) { this.written.push(Buffer.from(buf)) },
    resize(w, h, source) { this.resizes.push({ w, h, source }) }
  }
}

test('makeRtcClient.channel.messages[1].send frames stdout through the DataSession', () => {
  const mockSession = new MockDataSession()
  const client = makeRtcClient('peer-a', mockSession)
  client.channel.messages[1].send(Buffer.from('hello'))
  assert.equal(mockSession.sent.length, 1)
  assert.equal(mockSession.sent[0].peerPubkey, 'peer-a')
  assert.equal(mockSession.sent[0].payload[0], FRAME.STDOUT)
})

test('peer-open adds an RTC client to the shared session', () => {
  const shared = makeMockSharedSession()
  const mockSession = new MockDataSession()
  wireRtcTransport(shared, mockSession)

  mockSession.emitPeerOpen('peer-a')

  assert.equal(shared.added.length, 1)
  assert.equal(shared.added[0].peerPubkey, 'peer-a')
})

test('peer-close removes the matching RTC client from the shared session', () => {
  const shared = makeMockSharedSession()
  const mockSession = new MockDataSession()
  wireRtcTransport(shared, mockSession)

  mockSession.emitPeerOpen('peer-a')
  mockSession.emitPeerClose('peer-a')

  assert.equal(shared.removed.length, 1)
  assert.equal(shared.removed[0].peerPubkey, 'peer-a')
})

test('peer-close for an unknown peer is a no-op (never joined / already removed)', () => {
  const shared = makeMockSharedSession()
  const mockSession = new MockDataSession()
  wireRtcTransport(shared, mockSession)

  mockSession.emitPeerClose('never-joined')

  assert.equal(shared.removed.length, 0)
})

test('incoming stdin frame is written into the shared PTY', () => {
  const shared = makeMockSharedSession()
  const mockSession = new MockDataSession()
  wireRtcTransport(shared, mockSession)
  mockSession.emitPeerOpen('peer-a')

  mockSession.emitData('peer-a', encodeFrame(FRAME.STDIN, 'ls\n'))

  assert.equal(shared.written.length, 1)
  assert.equal(shared.written[0].toString(), 'ls\n')
})

test('incoming resize frame resizes the shared session with the RTC client as source', () => {
  const shared = makeMockSharedSession()
  const mockSession = new MockDataSession()
  wireRtcTransport(shared, mockSession)
  mockSession.emitPeerOpen('peer-a')

  mockSession.emitData('peer-a', encodeFrame(FRAME.RESIZE, { width: 100, height: 30 }))

  assert.equal(shared.resizes.length, 1)
  assert.equal(shared.resizes[0].w, 100)
  assert.equal(shared.resizes[0].h, 30)
  assert.equal(shared.resizes[0].source.peerPubkey, 'peer-a')
})

test('malformed/empty data frame is ignored, not thrown', () => {
  const shared = makeMockSharedSession()
  const mockSession = new MockDataSession()
  wireRtcTransport(shared, mockSession)
  mockSession.emitPeerOpen('peer-a')

  assert.doesNotThrow(() => mockSession.emitData('peer-a', new Uint8Array(0)))
  assert.equal(shared.written.length, 0)
  assert.equal(shared.resizes.length, 0)
})

test('two RTC peers both receive broadcast stdout independently', () => {
  const shared = makeMockSharedSession()
  const mockSession = new MockDataSession()
  wireRtcTransport(shared, mockSession)
  mockSession.emitPeerOpen('peer-a')
  mockSession.emitPeerOpen('peer-b')

  for (const client of shared.added) client.channel.messages[1].send(Buffer.from('hi'))

  assert.equal(mockSession.sent.length, 2)
  assert.deepEqual(mockSession.sent.map((s) => s.peerPubkey).sort(), ['peer-a', 'peer-b'])
})
