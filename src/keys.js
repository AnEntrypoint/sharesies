// Deterministic keypair derivation from a shared seed.
//
// Both the server and every client hash the same seed string into the same
// Curve25519 keypair via HyperDHT. The resulting public key is the address on
// the DHT, so sharing the seed == sharing the connection.

import { createHash, randomBytes } from 'node:crypto'

export async function deriveKeyPair(seedString) {
  const DHT = (await import('hyperdht')).default ?? (await import('hyperdht'))
  const seed = createHash('sha256').update(String(seedString)).digest()
  return { keyPair: DHT.keyPair(seed), DHT, seed }
}

export function randomSeed() {
  return randomBytes(32).toString('hex')
}
