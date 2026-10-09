#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { runServer, RUN_COMMAND } from './src/server.js'
import { runClient } from './src/client.js'

const HELP = `sharesies — realtime shared TUI over HyperDHT

SHARE A SPECIFIC APP (server, no flags needed — just name the app):
  ${RUN_COMMAND} htop                 Share a specific app
  ${RUN_COMMAND} vim                  Share another app
  ${RUN_COMMAND} --app "vim -c help"  App with arguments
  ${RUN_COMMAND} --shell             Share your login shell instead
  ${RUN_COMMAND} --key <seed>        Use a fixed seed (stable invite)
  ${RUN_COMMAND} --web <app>         Also reachable from a browser over WebRTC

WEBRTC NAT-TRAVERSAL TUNING (only with --web):
  --rtc-port-range <begin>-<end>    Pin ICE to a fixed UDP port range
                                     (port-forward that range for strict NATs)
  --rtc-udp-mux                     Share one UDP port across all RTC peers
                                     (fewer ports to open on a firewall; do
                                     not combine with running a second
                                     sharesies --web instance on the same host)
  --rtc-proxy <socks5|http>://host:port
                                     Route WebRTC ICE through a proxy, for
                                     networks that block direct UDP/TCP

JOIN (client, give this to a friend):
  ${RUN_COMMAND} --connect <seed>
  ${RUN_COMMAND} <seed>             (same as above, if seed looks like a key)
  ${RUN_COMMAND} --connect <a> --connect <b>
                                    Join several sessions in one terminal and
                                    switch between them. Press Ctrl+] then:
                                      1-9    jump to session N
                                      n / p  next / previous session
                                      q      detach from all sessions
                                      Ctrl+] send a literal Ctrl+] to the app

Notes:
  - You share ONE app directly — no terminal wrapper. When that app exits,
    sharesies closes.
  - The seed is the password. Anyone with the connect command joins the SAME
    live session and can see + type in the shared app.
  - No ports, no servers, no firewall config. End-to-end encrypted by HyperDHT.
`

// "socks5://user:pass@host:port" or "http://host:port" -> node-datachannel's
// ProxyServer shape ({ type, ip, port, username?, password? }).
function parseProxyUrl(input) {
  let url
  try {
    url = new URL(input)
  } catch {
    throw new Error(`--rtc-proxy: not a valid URL: ${input}`)
  }
  const type = url.protocol === 'socks5:' ? 'Socks5' : url.protocol === 'http:' ? 'Http' : null
  if (!type) throw new Error(`--rtc-proxy: unsupported scheme "${url.protocol}" (use socks5:// or http://)`)
  if (!url.hostname || !url.port) throw new Error(`--rtc-proxy: URL must include host and port: ${input}`)
  const proxy = { type, ip: url.hostname, port: Number(url.port) }
  if (url.username) proxy.username = decodeURIComponent(url.username)
  if (url.password) proxy.password = decodeURIComponent(url.password)
  return proxy
}

function parsePortRange(input) {
  const m = /^(\d+)-(\d+)$/.exec(input || '')
  if (!m) throw new Error(`--rtc-port-range: expected "<begin>-<end>", got "${input}"`)
  const begin = Number(m[1])
  const end = Number(m[2])
  if (begin > end) throw new Error(`--rtc-port-range: begin (${begin}) must be <= end (${end})`)
  return { begin, end }
}

function parseArgs(argv) {
  const out = {
    connect: [], key: null, app: null, shell: false, web: false, webBase: null,
    rtcPortRangeBegin: undefined, rtcPortRangeEnd: undefined, rtcUdpMux: false, rtcProxy: undefined,
    positionals: [], help: false
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--connect') out.connect.push(argv[++i])
    else if (a === '--key') out.key = argv[++i]
    else if (a === '--app') out.app = argv[++i]
    else if (a === '--shell') out.shell = true
    else if (a === '--web') out.web = true
    else if (a === '--web-base') out.webBase = argv[++i]
    else if (a === '--rtc-port-range') { const r = parsePortRange(argv[++i]); out.rtcPortRangeBegin = r.begin; out.rtcPortRangeEnd = r.end }
    else if (a === '--rtc-udp-mux') out.rtcUdpMux = true
    else if (a === '--rtc-proxy') out.rtcProxy = parseProxyUrl(argv[++i])
    else if (a.startsWith('--')) { /* ignore unknown long flags */ }
    else out.positionals.push(a)
  }
  return out
}

async function main() {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)

  if (args.help) {
    process.stdout.write(HELP)
    return
  }

  if (args.connect.length) {
    if (args.connect.some((s) => !s)) {
      process.stderr.write(`sharesies: --connect needs a seed, e.g.  ${RUN_COMMAND} --connect <seed>\n`)
      process.exit(1)
    }
    return await runClient(args.connect)
  }

  // Positionals that all look like seeds are a connect request (one or more).
  const isSeed = (s) => /^[\da-fA-F]{16,}$/.test(s)
  if (args.positionals.length && args.positionals.every(isSeed)) {
    return await runClient(args.positionals)
  }

  const rtcOpts = {
    web: args.web,
    webBase: args.webBase || undefined,
    rtcPortRangeBegin: args.rtcPortRangeBegin,
    rtcPortRangeEnd: args.rtcPortRangeEnd,
    rtcUdpMux: args.rtcUdpMux,
    rtcProxy: args.rtcProxy
  }

  // Otherwise: server mode. A specific app must be named.
  if (args.shell) {
    const { defaultShell } = await import('./src/server.js')
    return await runServer({ seed: args.key || undefined, command: defaultShell(), ...rtcOpts })
  }

  const appParts = args.app
    ? args.app.split(/\s+/).filter(Boolean)
    : args.positionals

  if (appParts.length === 0) {
    process.stderr.write('sharesies shares a specific app directly.\n\n')
    process.stderr.write(`  ${RUN_COMMAND} <app> [args...]     e.g.  ${RUN_COMMAND} htop\n`)
    process.stderr.write(`  ${RUN_COMMAND} --app "vim -c help"\n`)
    process.stderr.write(`  ${RUN_COMMAND} --shell             (share your login shell)\n`)
    process.stderr.write(`  ${RUN_COMMAND} --web <app>         (also reachable from a browser)\n`)
    process.stderr.write(`  ${RUN_COMMAND} --connect <seed>    (join a session)\n\n`)
    process.stderr.write('The named app runs in your terminal; when it exits, sharesies closes.\n')
    process.exit(1)
  }

  const command = appParts[0]
  const appArgs = appParts.slice(1)

  return await runServer({ seed: args.key || undefined, command, args: appArgs, ...rtcOpts })
}

// npx/bunx launch this file through a symlink in node_modules/.bin, while
// import.meta.url is the resolved real path. Compare against the real path or
// the CLI silently does nothing when run as a bin.
const isMain = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
})()

if (isMain) {
  main().catch((err) => {
    process.stderr.write('sharesies fatal: ' + (err && err.message ? err.message : err) + '\n')
    process.exit(1)
  })
}
