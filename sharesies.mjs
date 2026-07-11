#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { runServer } from './src/server.js'
import { runClient } from './src/client.js'

const HELP = `sharesies — realtime shared TUI over HyperDHT

SHARE (server, no params needed):
  npx sharesies                 Share your default shell
  npx sharesies htop            Share a specific app
  npx sharesies --app "vim -c help"   Share an app with arguments
  npx sharesies --key <seed>    Use a fixed seed (stable invite)

JOIN (client, give this to a friend):
  npx sharesies --connect <seed>
  npx sharesies <seed>          (same as above, if seed looks like a key)

Notes:
  - The seed is the password. Anyone with the connect command joins the SAME
    live session and can see + type in the shared terminal.
  - The session ends when the shared app exits. Ctrl+C closes sharesies.
  - No ports, no servers, no firewall config. End-to-end encrypted by HyperDHT.
`

function parseArgs(argv) {
  const out = { connect: null, key: null, app: null, positionals: [], help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--connect') out.connect = argv[++i]
    else if (a === '--key') out.key = argv[++i]
    else if (a === '--app') out.app = argv[++i]
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

  // Otherwise: server mode.
  const appParts = args.app
    ? args.app.split(/\s+/).filter(Boolean)
    : args.positionals
  const command = appParts[0] || null
  const appArgs = appParts.slice(1)

  return await runServer({ seed: args.key || undefined, command, args: appArgs })
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
