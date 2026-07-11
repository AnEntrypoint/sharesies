#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { runServer } from './src/server.js'
import { runClient } from './src/client.js'

const HELP = `sharesies — realtime shared TUI over HyperDHT

SHARE A SPECIFIC APP (server, no flags needed — just name the app):
  npx sharesies htop                 Share a specific app
  npx sharesies vim                  Share another app
  npx sharesies --app "vim -c help"  App with arguments
  npx sharesies --shell             Share your login shell instead
  npx sharesies --key <seed>        Use a fixed seed (stable invite)
  npx sharesies --web <app>         Also reachable from a browser over WebRTC

JOIN (client, give this to a friend):
  npx sharesies --connect <seed>
  npx sharesies <seed>              (same as above, if seed looks like a key)

Notes:
  - You share ONE app directly — no terminal wrapper. When that app exits,
    sharesies closes.
  - The seed is the password. Anyone with the connect command joins the SAME
    live session and can see + type in the shared app.
  - No ports, no servers, no firewall config. End-to-end encrypted by HyperDHT.
`

function parseArgs(argv) {
  const out = { connect: null, key: null, app: null, shell: false, web: false, webBase: null, positionals: [], help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--connect') out.connect = argv[++i]
    else if (a === '--key') out.key = argv[++i]
    else if (a === '--app') out.app = argv[++i]
    else if (a === '--shell') out.shell = true
    else if (a === '--web') out.web = true
    else if (a === '--web-base') out.webBase = argv[++i]
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

  if (args.connect) {
    if (!args.connect) {
      process.stderr.write('Error: --connect requires a seed\n')
      process.exit(1)
    }
    return await runClient(args.connect)
  }

  // A single hex-looking positional is treated as a connect seed.
  if (args.positionals.length === 1 && /^[\da-fA-F]{16,}$/.test(args.positionals[0])) {
    return await runClient(args.positionals[0])
  }

  // Otherwise: server mode. A specific app must be named.
  if (args.shell) {
    const { defaultShell } = await import('./src/server.js')
    return await runServer({ seed: args.key || undefined, command: defaultShell(), web: args.web, webBase: args.webBase || undefined })
  }

  const appParts = args.app
    ? args.app.split(/\s+/).filter(Boolean)
    : args.positionals

  if (appParts.length === 0) {
    process.stderr.write('sharesies shares a specific app directly.\n\n')
    process.stderr.write('  npx sharesies <app> [args...]     e.g.  npx sharesies htop\n')
    process.stderr.write('  npx sharesies --app "vim -c help"\n')
    process.stderr.write('  npx sharesies --shell             (share your login shell)\n')
    process.stderr.write('  npx sharesies --web <app>         (also reachable from a browser)\n')
    process.stderr.write('  npx sharesies --connect <seed>    (join a session)\n\n')
    process.stderr.write('The named app runs in your terminal; when it exits, sharesies closes.\n')
    process.exit(1)
  }

  const command = appParts[0]
  const appArgs = appParts.slice(1)

  return await runServer({ seed: args.key || undefined, command, args: appArgs, web: args.web, webBase: args.webBase || undefined })
}

const isMain = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
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
