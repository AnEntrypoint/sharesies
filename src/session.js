// Shared TUI session.
//
// A single PTY runs the chosen app. The server's own terminal (if it is a TTY)
// and every connected client all see the same byte stream and can all write to
// the PTY. The lifecycle is modelled with an xstate state machine so that
// teardown happens exactly once no matter how many clients leave or how the app
// exits (including a race between APP_EXIT and an external TERMINATE).

import { createMachine, createActor } from 'xstate'

const sessionMachine = createMachine({
  id: 'sharedSession',
  initial: 'spawning',
  states: {
    spawning: {
      on: { SPAWNED: 'running', EXIT: 'closing' }
    },
    running: {
      on: { EXIT: 'closing' }
    },
    closing: {
      type: 'final'
    }
  }
})

async function defaultPtyFactory(opts) {
  const PTY = (await import('tt-native')).default ?? (await import('tt-native'))
  return PTY.spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    env: opts.env,
    width: opts.width,
    height: opts.height
  })
}

export class SharedSession {
  constructor({ command, args, env, cwd, width = 80, height = 24, localTTY = false, ptyFactory }) {
    this.command = command
    this.args = args || []
    this.env = env
    this.cwd = cwd
    this.width = width
    this.height = height
    this.localTTY = localTTY
    this.ptyFactory = ptyFactory || defaultPtyFactory

    this.clients = new Set()
    this._nextId = 1
    this._exitCode = null
    this._exitListeners = new Set()
    this._exited = false
    this.pty = null

    this.actor = createActor(sessionMachine)
    this.actor.start()
  }

  async start() {
    try {
      this.pty = await this.ptyFactory({
        command: this.command,
        args: this.args,
        cwd: this.cwd,
        env: this.env,
        width: this.width,
        height: this.height
      })
    } catch (err) {
      this._broadcastStderr(Buffer.from(String(err) + '\n'))
      this._handleExit(1)
      return
    }

    this.pty.on('data', (data) => {
      if (this.localTTY) process.stdout.write(data)
      this._broadcastStdout(data)
    })
    this.pty.once('exit', (code) => this._handleExit(code))
    this.pty.once('close', () => {})

    this.actor.send({ type: 'SPAWNED' })
  }

  addClient(client) {
    client.id = this._nextId++
    this.clients.add(client)
    // Bring the newly joined client's terminal in sync with the live PTY size.
    this._sendResize(client, this.width, this.height)
  }

  removeClient(client) {
    this.clients.delete(client)
  }

  // Input from the local terminal or any client.
  write(buf) {
    if (!this.pty || this._exited) return
    if (buf === null) this.pty.write(Buffer.alloc(0))
    else this.pty.write(buf)
  }

  // A participant resized. The PTY follows the new size and every other
  // participant is told to match, keeping "the same view" invariant.
  resize(width, height, source) {
    this.width = width
    this.height = height
    if (this.pty && !this._exited) {
      try {
        this.pty.resize(width, height)
      } catch {}
    }
    for (const client of this.clients) {
      if (client === source) continue
      this._sendResize(client, width, height)
    }
  }

  _sendResize(client, w, h) {
    try {
      client.channel.messages[4].send({ width: w, height: h })
    } catch {}
  }

  _broadcastStdout(data) {
    for (const client of this.clients) {
      try {
        client.channel.messages[1].send(data)
      } catch {}
    }
  }

  _broadcastStderr(data) {
    if (this.localTTY) process.stderr.write(data)
    for (const client of this.clients) {
      try {
        client.channel.messages[2].send(data)
      } catch {}
    }
  }

  onAppExit(cb) {
    this._exitListeners.add(cb)
  }

  _handleExit(code) {
    if (this.actor.getSnapshot().status === 'done') return
    this._exited = true
    this.actor.send({ type: 'EXIT' })

    this._exitCode = typeof code === 'number' && Number.isFinite(code) && code >= 0 ? code : 0

    for (const client of this.clients) {
      try {
        client.channel.messages[3].send(this._exitCode)
      } catch {}
      try {
        client.channel.close()
      } catch {}
    }
    this.clients.clear()

    for (const cb of this._exitListeners) {
      try {
        cb(this._exitCode)
      } catch {}
    }
  }

  destroy() {
    if (this.pty) {
      try {
        this.pty.kill('SIGKILL')
      } catch {}
    }
  }
}

export function createSharedSession(opts) {
  return new SharedSession(opts)
}
