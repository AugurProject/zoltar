import { describe, expect, test } from 'bun:test'
import { validateStepReceiptEvidence } from '../../src/execution/receipt-validation.ts'
import { TRADING_OPERATIONS } from '../../src/operations/trading.ts'
import type { OperationEvidence } from '../../src/operations/types.ts'
import { address, hash, snapshotFixture } from './fixture.ts'

const options = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	maximumBlockIntervalSeconds: 15,
	maxEthSpendAttoEth: (10n ** 15n).toString(),
	maxRepSpendAttoRep: (10n ** 15n).toString(),
	minimumEthReserveAttoEth: (10n ** 16n).toString(),
	minimumRepReserveAttoRep: (10n ** 18n).toString(),
	seed: 1,
} as const

describe('idempotent trading keeper evidence', () => {
	test('targets the requested genesis pool when unrelated eligible topology exists', () => {
		const snapshot = snapshotFixture()
		const firstPool = snapshot.pools[0]
		if (firstPool === undefined) throw new Error('Pool fixture missing')
		const genesisPool = { ...firstPool, address: address(91), questionId: '78' }
		snapshot.pools.push(genesisPool)
		snapshot.pairs = []
		const definition = TRADING_OPERATIONS.find(candidate => candidate.id === 'trading.pair.create')
		const plan = definition?.buildPlan(snapshot, { ...options, genesisInitializationTarget: { pool: genesisPool.address, questionId: genesisPool.questionId, universeId: '0' } })
		expect(plan?.metadata).toMatchObject({ pool: genesisPool.address })
	})

	test('accepts a successful no-log pair creation after a competitor creates the canonical pair', () => {
		const snapshot = snapshotFixture()
		snapshot.pairs = []
		const definition = TRADING_OPERATIONS.find(candidate => candidate.id === 'trading.pair.create')
		const plan = definition?.buildPlan(snapshot, options)
		const step = plan?.steps[0]
		const evidence = step?.evidence[0] as Extract<OperationEvidence, { kind: 'storage-postcondition' }> | undefined
		if (step === undefined || evidence === undefined) throw new Error('Pair creation evidence is missing')
		expect(evidence).toMatchObject({ functionName: 'getPair', relation: 'greater-than', expected: '0' })
		const canonicalPair = address(90)
		expect(() => validateStepReceiptEvidence(step, { blockHash: hash(101), blockNumber: 101n, logs: [], status: 'success', transactionHash: hash(102) }, { storage: [{ after: canonicalPair, before: canonicalPair, evidence }] })).not.toThrow()
	})
})
