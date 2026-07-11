// Wire framing for the shared TUI session over a wireweave RTCDataChannel.
//
// protomux (used by the HyperDHT transport) gives multiplexed typed message
// channels for free. A single RTCDataChannel is one raw binary pipe, so the
// same five logical streams (stdin / stdout / stderr / exit / resize) are
// multiplexed here with a 1-byte type prefix instead.

export const FRAME = {
  STDIN: 0,
  STDOUT: 1,
  STDERR: 2,
  EXIT: 3,
  RESIZE: 4
}

const te = new TextEncoder()
const td = new TextDecoder()

export function encodeFrame(type, payload) {
  if (type === FRAME.EXIT) {
    const buf = new Uint8Array(5)
    buf[0] = type
    new DataView(buf.buffer).setUint32(1, payload >>> 0, false)
    return buf
  }
  if (type === FRAME.RESIZE) {
    const buf = new Uint8Array(9)
    buf[0] = type
    const view = new DataView(buf.buffer)
    view.setUint32(1, payload.width >>> 0, false)
    view.setUint32(5, payload.height >>> 0, false)
    return buf
  }
  const bytes = payload instanceof Uint8Array ? payload : te.encode(String(payload))
  const buf = new Uint8Array(1 + bytes.length)
  buf[0] = type
  buf.set(bytes, 1)
  return buf
}

export function decodeFrame(data) {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer ?? data)
  if (bytes.length === 0) return null
  const type = bytes[0]
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (type === FRAME.EXIT) {
    return { type, payload: view.getUint32(1, false) }
  }
  if (type === FRAME.RESIZE) {
    return { type, payload: { width: view.getUint32(1, false), height: view.getUint32(5, false) } }
  }
  return { type, payload: bytes.subarray(1) }
}

export function decodeText(payload) {
  return td.decode(payload)
}
