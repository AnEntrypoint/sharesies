// sharesies — SDK entry point.
//
// Programmatic access to the same server/client used by the CLI.
export { runServer } from './src/server.js'
export { runClient } from './src/client.js'
export { deriveKeyPair, randomSeed } from './src/keys.js'
export { createSharedSession, SharedSession } from './src/session.js'
export { getProtocol } from './src/protocol.js'
