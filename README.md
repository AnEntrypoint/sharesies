# joinin

Realtime, peer-to-peer **shared terminal**. Run a single TUI app and let friends
connect over HyperDHT to see the **same screen** and **type into the same
session** — no ports, no servers, no firewall config, no pop-up windows. Built on
[hyperssh](https://github.com/holepunchto/hypershell) (the holepunch project).

```
# You (the host) — runs with NO parameters:
npx joinin
# → prints an invite command to give a friend

# Your friend:
npx joinin --connect <seed>
```

Both of you now share one live terminal. Multiple friends can each run the
connect command and join the **same session** at once.

Friends without a terminal can also join **from a browser**, no install —
see [Browser / GitHub Pages client](#browser--github-pages-client) below.

---

## Why joinin

- **Realtime, not atomic.** Unlike remote-shell tools that ship command output
  after the fact, `joinin` streams the PTY byte-for-byte in both directions,
  so server and every client see the exact same view and can type live.
- **No popups.** The shared app runs right in your current terminal.
- **One app, one session.** It runs a single named app directly (no shell
  wrapper). When the app exits, `joinin` closes.
- **Many clients, one session.** Multiple people can connect and interact with
  the same PTY. Session lifecycle is modelled with an
  [xstate](https://stately.ai/docs/xstate) state machine, so teardown happens
  exactly once no matter how clients join/leave or the app exits.
- **Encrypted P2P.** HyperDHT gives peer discovery, NAT traversal (UDP
  holepunching) and end-to-end Noise encryption. The shared seed *is* the
  address + secret.

---

## Usage

### Share a specific app (server)

```bash
npx joinin htop                 # share a specific app directly
npx joinin vim                  # share another app
npx joinin --app "vim -c help"  # app with arguments
npx joinin --key <seed>         # fixed seed → stable invite command
npx joinin --shell              # share your login shell instead
```

You name the app and `joinin` runs **that app directly** (no shell wrapper)
in your terminal, advertises it on HyperDHT, and prints the invite command.
When the app exits, `joinin` closes. Give the invite command to a friend.

### Join a session (client)

```bash
npx joinin --connect <seed>
# or, when the seed looks like a key:
npx joinin <seed>
```

`bunx joinin ...` is equivalent to `npx joinin ...`.

---

## Browser / GitHub Pages client

```bash
npx joinin --web htop     # also reachable from a browser over WebRTC
```

The host prints a second invite — a link, not a command:

```
https://anentrypoint.github.io/sharesies/#<seed>
```

Anyone who opens that link joins the **same live session** as CLI clients,
straight from the browser: no install, no extension. Under the hood the
browser client uses [wireweave](https://github.com/AnEntrypoint/wireweave)
for a peer-to-peer `RTCDataChannel`, signaled over public nostr relays, and
renders the shared PTY with [xterm.js](https://xterm.js.org). The CLI server
joins the same WebRTC room directly (via
[node-datachannel](https://github.com/murat-dogan/node-datachannel)'s native
WebRTC binding) — there is no separate relay process to keep alive, and one
seed is a single invite for both transports.

`--web` is opt-in: plain `npx joinin <app>` stays HyperDHT-only with zero
extra native dependencies pulled in at install/run time.

**Privacy.** The GitHub Pages URL itself is public — anyone can load the page.
What's private is the **session**: joining requires the invite seed, exactly
like the CLI's `--connect <seed>`. The page never lists or discovers other
sessions. Treat the seed like a password: whoever has it can see and type into
your terminal.

### Local development

```bash
npm run dev:web    # rebuild web/bundle.js on change
npm run build:web  # one-off production build
```

Then serve `web/` with any static file server and open it with `#<seed>`
matching a locally running `npx joinin --web <app>`.

### NAT traversal tuning

The CLI server is usually the peer most likely sitting behind a restrictive
NAT — a home router, carrier-grade NAT, a corporate firewall — since browser
clients' own OS network stacks tend to be more permissive. `--web` goes
beyond a plain polyfilled `RTCPeerConnection`: it constructs
[node-datachannel](https://github.com/murat-dogan/node-datachannel)'s native
peer directly, unlocking tuning the standard WebRTC API doesn't expose:

```bash
npx joinin --web --rtc-port-range 50000-51000 htop
# pin ICE to a fixed UDP range — port-forward that range on a strict NAT

npx joinin --web --rtc-udp-mux htop
# share one UDP port across every browser peer — fewer ports to open on a
# firewall when several friends join at once. Verified: this is safe across
# separate processes/machines (the real deployment shape); it specifically
# breaks same-process self-connections, which is why it's opt-in rather than
# the default — don't combine it with running two joinin --web instances
# on the same host.

npx joinin --web --rtc-proxy socks5://user:pass@proxyhost:1080 htop
# route WebRTC ICE through a SOCKS5/HTTP proxy — for networks that block
# direct UDP/TCP egress entirely
```

The server logs how each browser peer actually connected:

```
joinin: browser peer a1b2c3d4e5f6 connected direct (host/prflx)
joinin: browser peer f6e5d4c3b2a1 connected via TURN relay
```

`direct` means the punch succeeded; `via TURN relay` means it fell back to a
relay (still works, just extra latency/bandwidth cost on the relay operator).

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
   `joinin` exits.

With `--web`, a second transport runs alongside: the server derives a room id
from `sha256("sharesies:" + seed)` and joins it as a wireweave `DataSession`
peer. Each browser client that joins the same room gets its own
`RTCDataChannel`; since a data channel is one raw binary pipe (no protomux-style
multiplexing), `stdin / stdout / stderr / exit / resize` are carried as a small
1-byte-type-prefixed frame instead (`src/rtc-protocol.js`). Both transports feed
the same `SharedSession`, so a HyperDHT client and a browser client see and
affect the identical live PTY.

---

## Security

- HyperDHT traffic is end-to-end encrypted via the Noise protocol.
- WebRTC traffic (`--web`) is encrypted via DTLS/SRTP per the WebRTC spec;
  peer discovery/signaling happens over public nostr relays (see
  [wireweave](https://github.com/AnEntrypoint/wireweave)), using a fresh,
  in-memory-only nostr identity generated per server/client process — never
  persisted, never your real identity.
- The seed is effectively a password for **both** transports: only someone
  with it can derive the HyperDHT public key or the WebRTC room id. Generate a
  fresh seed per session; never log or commit it.
- The local host process is the only place the app runs.

---

## SDK

```js
import { runServer, runClient, deriveKeyPair, createSharedSession } from 'joinin'

await runServer({ command: 'htop' })        // host
await runClient('my-shared-seed-hex')        // join

await runServer({ command: 'htop', web: true })   // host, also reachable from a browser
```

---

## CI / publishing

Pushing to `main` runs tests and publishes a patched version to npm
(`.github/workflows/publish.yml`). A `NPM_TOKEN` repository secret is required
for publishing.

Pushing changes under `web/` (or the shared `src/rtc-protocol.js` framing)
rebuilds and deploys the browser client to GitHub Pages
(`.github/workflows/pages.yml`), independent of the npm publish flow.

---

## License

MIT
