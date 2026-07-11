import { createRtcTransport, describeSelectedCandidatePair } from '../src/rtc-node.js'

const namespace = process.argv[2]
const role = process.argv[3]
const udpMux = process.argv[4] === 'mux'

const t = await createRtcTransport({ namespace, udpMux })
let peerPk = null

t.session.addEventListener('peer-open', (e) => {
  peerPk = e.detail.peerPubkey
  const cand = describeSelectedCandidatePair(t.session.peers.get(peerPk).pc)
  console.log(`[${role}] peer-open`, JSON.stringify(cand))
  if (role === 'guest') t.session.send(peerPk, new TextEncoder().encode('CROSS_PROCESS_MARKER'))
})
t.session.addEventListener('data', (e) => {
  const text = new TextDecoder().decode(e.detail.data)
  if (text === 'CROSS_PROCESS_MARKER') {
    console.log(`[${role}] received marker`)
    if (role === 'host') t.session.send(peerPk, e.detail.data)
    if (role === 'guest') { console.log('RESULT PASS'); process.exit(0) }
  }
})

await t.session.connect('cross-process-room', { displayName: role })
console.log(`[${role}] connected to signaling, udpMux=${udpMux}`)

setTimeout(() => { console.log('RESULT TIMEOUT'); process.exit(1) }, 25000)
