import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { SharedSession } from './session.js'

function makeMockPty() {
  const pty = new EventEmitter()
  pty.written = []
  pty.resizes = []
  pty.write = (buf) => pty.written.push(Buffer.from(buf))
  pty.resize = (w, h) => pty.resizes.push([w, h])
  pty.kill = () => {}
  return pty
}

function makeClient() {
  const captured = { stdout: [], stderr: [], exit: [], resize: [] }
  const channel = {
    messages: [
      { send() {} },
      { send(d) { captured.stdout.push(Buffer.from(d)) } },
      { send(d) { captured.stderr.push(Buffer.from(d)) } },
      { send(c) { captured.exit.push(c) } },
      { send(r) { captured.resize.push(r) } }
    ],
    close() { this.closed = true }
  }
  return { channel, captured }
}

test('broadcasts PTY output to every connected client', async () => {
  const session = new SharedSession({ command: 'sh', ptyFactory: makeMockPty })
  await session.start()
  const a = makeClient()
  const b = makeClient()
  session.addClient(a)
  session.addClient(b)

  session.pty.emit('data', Buffer.from('hello world'))

  assert.deepEqual(Buffer.concat(a.captured.stdout).toString(), 'hello world')
  assert.deepEqual(Buffer.concat(b.captured.stdout).toString(), 'hello world')
  session.destroy()
})

test('writes client input into the shared PTY', async () => {
  const session = new SharedSession({ command: 'sh', ptyFactory: makeMockPty })
  await session.start()
  const a = makeClient()
  session.addClient(a)

  session.write(Buffer.from('ls\n'))

  assert.deepEqual(Buffer.concat(session.pty.written).toString(), 'ls\n')
  session.destroy()
})

test('resize propagates to other clients but not the source', async () => {
  const session = new SharedSession({ command: 'sh', ptyFactory: makeMockPty })
  await session.start()
  const a = makeClient()
  const b = makeClient()
  session.addClient(a)
  session.addClient(b)
  // Clear the join-sync resizes so we only observe the explicit resize below.
  a.captured.resize.length = 0
  b.captured.resize.length = 0

  session.resize(120, 40, a)

  assert.deepEqual(session.pty.resizes.at(-1), [120, 40])
  assert.equal(b.captured.resize.length, 1)
  assert.deepEqual(b.captured.resize[0], { width: 120, height: 40 })
  assert.equal(a.captured.resize.length, 0)
  session.destroy()
})

test('new client is synced to the current PTY size on join', async () => {
  const session = new SharedSession({ command: 'sh', ptyFactory: makeMockPty })
  await session.start()
  session.resize(200, 50)
  const a = makeClient()
  session.addClient(a)

  assert.equal(a.captured.resize.length, 1)
  assert.deepEqual(a.captured.resize[0], { width: 200, height: 50 })
  session.destroy()
})

test('app exit broadcasts exit code once and fires onAppExit exactly once', async () => {
  const session = new SharedSession({ command: 'sh', ptyFactory: makeMockPty })
  await session.start()
  const a = makeClient()
  const b = makeClient()
  session.addClient(a)
  session.addClient(b)

  let exitCalls = 0
  session.onAppExit(() => { exitCalls++ })

  session.pty.emit('exit', 3)
  session.pty.emit('exit', 3) // double exit must be ignored

  assert.equal(a.captured.exit[0], 3)
  assert.equal(b.captured.exit[0], 3)
  assert.equal(exitCalls, 1)
  assert.equal(session.actor.getSnapshot().status, 'done')
  assert.equal(a.channel.closed, true)
  assert.equal(b.channel.closed, true)
})
