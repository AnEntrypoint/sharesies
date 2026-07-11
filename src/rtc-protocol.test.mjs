import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FRAME, encodeFrame, decodeFrame, decodeText } from './rtc-protocol.js'

test('stdout frame round-trips binary payload', () => {
  const payload = new Uint8Array([104, 101, 108, 108, 111]) // "hello"
  const frame = encodeFrame(FRAME.STDOUT, payload)
  const decoded = decodeFrame(frame)
  assert.equal(decoded.type, FRAME.STDOUT)
  assert.equal(decodeText(decoded.payload), 'hello')
})

test('stdin frame accepts a string payload', () => {
  const frame = encodeFrame(FRAME.STDIN, 'ls\n')
  const decoded = decodeFrame(frame)
  assert.equal(decoded.type, FRAME.STDIN)
  assert.equal(decodeText(decoded.payload), 'ls\n')
})

test('exit frame round-trips a uint32 code', () => {
  const frame = encodeFrame(FRAME.EXIT, 3)
  const decoded = decodeFrame(frame)
  assert.equal(decoded.type, FRAME.EXIT)
  assert.equal(decoded.payload, 3)
})

test('resize frame round-trips width/height', () => {
  const frame = encodeFrame(FRAME.RESIZE, { width: 120, height: 40 })
  const decoded = decodeFrame(frame)
  assert.equal(decoded.type, FRAME.RESIZE)
  assert.deepEqual(decoded.payload, { width: 120, height: 40 })
})

test('decodeFrame accepts a raw ArrayBuffer (as RTCDataChannel delivers)', () => {
  const frame = encodeFrame(FRAME.STDOUT, new Uint8Array([1, 2, 3]))
  const decoded = decodeFrame(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength))
  assert.equal(decoded.type, FRAME.STDOUT)
  assert.deepEqual(Array.from(decoded.payload), [1, 2, 3])
})

test('decodeFrame returns null for empty input', () => {
  assert.equal(decodeFrame(new Uint8Array(0)), null)
})

test('empty stdout payload round-trips to zero-length', () => {
  const frame = encodeFrame(FRAME.STDOUT, new Uint8Array(0))
  const decoded = decodeFrame(frame)
  assert.equal(decoded.payload.length, 0)
})

test('exit code at uint32 boundary round-trips', () => {
  const frame = encodeFrame(FRAME.EXIT, 255)
  assert.equal(decodeFrame(frame).payload, 255)
})
