// Wire protocol for the shared TUI session.
//
// Reuses hypershell's (holepunch "hyperssh") spawn/resize encodings so a
// `joinin` session is wire-compatible with the hypershell protocol. If the
// `hypershell` package is unavailable we fall back to a local reimplementation
// built on `compact-encoding` so the package stays self-contained.

let cached = null

async function loadHypershellProtocol() {
  const mod = await import('hypershell/messages.js')
  const m = mod.default ?? mod
  if (!m.handshakeSpawn || !m.resize) {
    throw new Error('hypershell/messages.js missing handshakeSpawn/resize')
  }
  return { handshakeSpawn: m.handshakeSpawn, resize: m.resize }
}

export async function getProtocol() {
  if (cached) return cached
  try {
    cached = await loadHypershellProtocol()
    return cached
  } catch {
    cached = await loadLocalProtocol()
    return cached
  }
}

async function loadLocalProtocol() {
  const c = (await import('compact-encoding')).default ?? (await import('compact-encoding'))
  const stringArray = c.array(c.string)

  const handshakeSpawn = {
    preencode(state, s) {
      c.string.preencode(state, s.command || '')
      stringArray.preencode(state, s.args || [])
      c.uint.preencode(state, s.width)
      c.uint.preencode(state, s.height)
    },
    encode(state, s) {
      c.string.encode(state, s.command || '')
      stringArray.encode(state, s.args || [])
      c.uint.encode(state, s.width)
      c.uint.encode(state, s.height)
    },
    decode(state) {
      return {
        command: c.string.decode(state),
        args: stringArray.decode(state),
        width: c.uint.decode(state),
        height: c.uint.decode(state)
      }
    }
  }

  const resize = {
    preencode(state, r) {
      c.uint.preencode(state, r.width)
      c.uint.preencode(state, r.height)
    },
    encode(state, r) {
      c.uint.encode(state, r.width)
      c.uint.encode(state, r.height)
    },
    decode(state) {
      return {
        width: c.uint.decode(state),
        height: c.uint.decode(state)
      }
    }
  }

  return { handshakeSpawn, resize }
}
