import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeNativePeerConnectionFactory, describeSelectedCandidatePair, deriveRoomFromSeed } from './rtc-node.js'

function mockNativeCtor() {
  const calls = []
  class MockPeerConnection {
    constructor(id, config) { calls.push({ id, config }) }
  }
  return { MockPeerConnection, calls }
}

test('createPeerConnection factory forwards iceServers as bare url strings to the native ctor', () => {
  const { MockPeerConnection, calls } = mockNativeCtor()
  class MockPolyfillRTCPeerConnection { constructor(opts) { this.opts = opts } }
  const factory = makeNativePeerConnectionFactory({ PeerConnection: MockPeerConnection, PolyfillRTCPeerConnection: MockPolyfillRTCPeerConnection })

  const pc = factory({ iceServers: [{ urls: 'stun:a:1' }, { urls: 'turn:b:2' }] })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].config.iceServers, ['stun:a:1', 'turn:b:2'])
  assert.ok(pc instanceof MockPolyfillRTCPeerConnection)
  assert.ok(pc.opts.peerConnection instanceof MockPeerConnection)
})

test('udpMux defaults to false — enableIceUdpMux is absent from native config unless explicitly requested', () => {
  const { MockPeerConnection, calls } = mockNativeCtor()
  class MockPolyfillRTCPeerConnection { constructor() {} }
  const factory = makeNativePeerConnectionFactory({ PeerConnection: MockPeerConnection, PolyfillRTCPeerConnection: MockPolyfillRTCPeerConnection })

  factory({ iceServers: [] })

  assert.equal('enableIceUdpMux' in calls[0].config, false)
})

test('udpMux:true adds enableIceUdpMux to the native config', () => {
  const { MockPeerConnection, calls } = mockNativeCtor()
  class MockPolyfillRTCPeerConnection { constructor() {} }
  const factory = makeNativePeerConnectionFactory({ udpMux: true, PeerConnection: MockPeerConnection, PolyfillRTCPeerConnection: MockPolyfillRTCPeerConnection })

  factory({ iceServers: [] })

  assert.equal(calls[0].config.enableIceUdpMux, true)
})

test('portRangeBegin/portRangeEnd are forwarded only when supplied', () => {
  const { MockPeerConnection, calls } = mockNativeCtor()
  class MockPolyfillRTCPeerConnection { constructor() {} }
  const withRange = makeNativePeerConnectionFactory({ portRangeBegin: 50000, portRangeEnd: 51000, PeerConnection: MockPeerConnection, PolyfillRTCPeerConnection: MockPolyfillRTCPeerConnection })
  const withoutRange = makeNativePeerConnectionFactory({ PeerConnection: MockPeerConnection, PolyfillRTCPeerConnection: MockPolyfillRTCPeerConnection })

  withRange({ iceServers: [] })
  withoutRange({ iceServers: [] })

  assert.equal(calls[0].config.portRangeBegin, 50000)
  assert.equal(calls[0].config.portRangeEnd, 51000)
  assert.equal('portRangeBegin' in calls[1].config, false)
})

test('proxy config is forwarded as proxyServer only when supplied', () => {
  const { MockPeerConnection, calls } = mockNativeCtor()
  class MockPolyfillRTCPeerConnection { constructor() {} }
  const proxy = { type: 'Socks5', ip: '127.0.0.1', port: 1080 }
  const withProxy = makeNativePeerConnectionFactory({ proxy, PeerConnection: MockPeerConnection, PolyfillRTCPeerConnection: MockPolyfillRTCPeerConnection })

  withProxy({ iceServers: [] })

  assert.deepEqual(calls[0].config.proxyServer, proxy)
})

test('describeSelectedCandidatePair returns null when no pair is selected yet', () => {
  const pc = { selectedCandidatePair: () => null }
  assert.equal(describeSelectedCandidatePair(pc), null)
})

test('describeSelectedCandidatePair returns null when selectedCandidatePair throws', () => {
  const pc = { selectedCandidatePair: () => { throw new Error('not connected') } }
  assert.equal(describeSelectedCandidatePair(pc), null)
})

test('describeSelectedCandidatePair reports relayed:false for a direct host/prflx pair', () => {
  const pc = { selectedCandidatePair: () => ({ local: { type: 'host' }, remote: { type: 'prflx' } }) }
  const desc = describeSelectedCandidatePair(pc)
  assert.deepEqual(desc, { localType: 'host', remoteType: 'prflx', relayed: false })
})

test('describeSelectedCandidatePair reports relayed:true when either side is a TURN relay', () => {
  const localRelay = { selectedCandidatePair: () => ({ local: { type: 'relay' }, remote: { type: 'host' } }) }
  const remoteRelay = { selectedCandidatePair: () => ({ local: { type: 'host' }, remote: { type: 'relay' } }) }
  assert.equal(describeSelectedCandidatePair(localRelay).relayed, true)
  assert.equal(describeSelectedCandidatePair(remoteRelay).relayed, true)
})

test('deriveRoomFromSeed is deterministic for the same seed', () => {
  assert.equal(deriveRoomFromSeed('seed-a'), deriveRoomFromSeed('seed-a'))
})

test('deriveRoomFromSeed differs for different seeds', () => {
  assert.notEqual(deriveRoomFromSeed('seed-a'), deriveRoomFromSeed('seed-b'))
})
