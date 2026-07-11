import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeSelectedCandidatePair } from './rtc-browser.js'

function mockStats(entries) {
  return new Map(entries.map((e) => [e.id, e]))
}

test('returns null when no candidate-pair report exists', async () => {
  const pc = { getStats: async () => mockStats([{ id: 'x', type: 'transport' }]) }
  assert.equal(await describeSelectedCandidatePair(pc), null)
})

test('returns null when getStats throws', async () => {
  const pc = { getStats: async () => { throw new Error('no stats') } }
  assert.equal(await describeSelectedCandidatePair(pc), null)
})

test('reports direct host/srflx pair as not relayed', async () => {
  const pc = {
    getStats: async () => mockStats([
      { id: 'pair-1', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'local-1', remoteCandidateId: 'remote-1' },
      { id: 'local-1', type: 'local-candidate', candidateType: 'host' },
      { id: 'remote-1', type: 'remote-candidate', candidateType: 'srflx' }
    ])
  }
  const desc = await describeSelectedCandidatePair(pc)
  assert.deepEqual(desc, { localType: 'host', remoteType: 'srflx', relayed: false })
})

test('reports relayed:true when the local candidate is a TURN relay', async () => {
  const pc = {
    getStats: async () => mockStats([
      { id: 'pair-1', type: 'candidate-pair', state: 'succeeded', selected: true, localCandidateId: 'local-1', remoteCandidateId: 'remote-1' },
      { id: 'local-1', type: 'local-candidate', candidateType: 'relay' },
      { id: 'remote-1', type: 'remote-candidate', candidateType: 'host' }
    ])
  }
  const desc = await describeSelectedCandidatePair(pc)
  assert.equal(desc.relayed, true)
})

test('ignores non-succeeded candidate pairs', async () => {
  const pc = {
    getStats: async () => mockStats([
      { id: 'pair-1', type: 'candidate-pair', state: 'in-progress', nominated: true, localCandidateId: 'local-1', remoteCandidateId: 'remote-1' },
      { id: 'local-1', type: 'local-candidate', candidateType: 'host' },
      { id: 'remote-1', type: 'remote-candidate', candidateType: 'host' }
    ])
  }
  assert.equal(await describeSelectedCandidatePair(pc), null)
})
