# sharesies

Realtime, peer-to-peer **shared terminal**. Run a single TUI app and let friends
connect over HyperDHT to see the **same screen** and **type into the same
session** — no ports, no servers, no firewall config, no pop-up windows. Built on
[hyperssh](https://github.com/holepunchto/hypershell) (the holepunch project).

```
# You (the host) — runs with NO parameters:
npx sharesies
# → prints an invite command to give a friend

# Your friend:
npx sharesies --connect <seed>
```

Both of you now share one live terminal. Multiple friends can each run the
connect command and join the **same session** at once.

---

## Why sharesies

- **Realtime, not atomic.** Unlike remote-shell tools that ship command output
  after the fact, `sharesies` streams the PTY byte-for-byte in both directions,
  so server and every client see the exact same view and can type live.
- **No popups.** The shared app runs right in your current terminal.
- **One app, one session.** It shares a single app (default: your shell). When
  the app exits, `sharesies` closes.
- **Many clients, one session.** Multiple people can connect and interact with
  the same PTY. Session lifecycle is modelled with an
  [xstate](https://stately.ai/docs/xstate) state machine, so teardown happens
  exactly once no matter how clients join/leave or the app exits.
- **Encrypted P2P.** HyperDHT gives peer discovery, NAT traversal (UDP
  holepunching) and end-to-end Noise encryption. The shared seed *is* the
  address + secret.

---

## Usage

### Share a terminal (server)

```bash
npx sharesies                 # share your default shell
npx sharesies htop            # share a specific app
npx sharesies --app "vim -c help"   # app with arguments
npx sharesies --key <seed>    # fixed seed → stable invite command
```

With no parameters, `sharesies` generates a fresh random seed, runs the app in
your terminal, and prints the invite command. Give that command to a friend.

### Join a session (client)

```bash
npx sharesies --connect <seed>
# or, when the seed looks like a key:
npx sharesies <seed>
```

`bunx sharesies ...` is equivalent to `npx sharesies ...`.

---

## How it works

```
[host terminal] ──stdin──┐
                         ├─▶ [single PTY running the app]
[client A] ──stdin───────┤        │  stdout/stderr
[client B] ──stdin───────┘        ├─▶ [host terminal]  (mirrored)
                                  └─▶ [client A] + [client B]  (broadcast)
```

1. Both sides derive the same Curve25519 keypair from the shared seed
   (`sha256(seed) → hyperdht.keyPair`).
2. The host advertises that public key on the DHT; the client connects to it.
3. A `protomux` channel using the hypershell protocol carries
   `stdin / stdout / stderr / exit / resize`.
4. The host keeps **one** PTY. Its output is mirrored to the host terminal and
   broadcast to every client; input from the host and every client is merged
   into the PTY.
5. A resize from any participant resizes the PTY and tells the others to match,
   preserving "the same view".
6. When the app exits, the exit code is sent to all clients, channels close, and
   `sharesies` exits.

---

## Security

- All traffic is end-to-end encrypted via the Noise protocol (HyperDHT).
- The seed is effectively a password: only someone with it can derive the public
  key and connect. Generate a fresh seed per session; never log or commit it.
- The local host process is the only place the app runs.

---

## SDK

```js
import { runServer, runClient, deriveKeyPair, createSharedSession } from 'sharesies'

await runServer({ command: 'htop' })        // host
await runClient('my-shared-seed-hex')        // join
```

---

## CI / publishing

Pushing to `main` runs tests and publishes a patched version to npm
(`.github/workflows/publish.yml`). A `NPM_TOKEN` repository secret is required
for publishing.

---

## License

MIT
