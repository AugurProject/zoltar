import { decodeFunctionData, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { describe, expect, test } from 'bun:test'
import { completeSetDefinition } from '../../src/operations/statoblast/complete-sets.ts'
import { snapshotFixture } from './fixture.ts'

const options = { seed: 1, maximumBlockIntervalSeconds: 15 }

function fixture() {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Missing pool fixture')
	pool.escalationGame = '0x0000000000000000000000000000000000000000'
	pool.settlementCollateralAttoEth = '1'
	pool.projectedSettlementCollateralAttoEth = '1'
	pool.additionalMintCapacityAttoEth = '0'
	return { snapshot, pool }
}

describe('standing commitment keeper planning', () => {
	for (const kind of ['redeem', 'winning'] as const) {
		test(`native ${kind} has no payout floor arguments`, () => {
			const { snapshot, pool } = fixture()
			pool.projectedSettlementCollateralAttoEth = pool.shareTokenSupplyAttoShares
			if (kind === 'winning') pool.questionOutcome = 1
			const plan = completeSetDefinition(kind).buildPlan(snapshot, options)
			const step = plan?.steps[0]
			if (step === undefined) throw new Error('Expected native redemption plan')
			const decoded = decodeFunctionData({ abi: parseAbi(['function redeemCompleteSet(uint256)', 'function redeemShares()']), data: step.data })
			expect(decoded.functionName).toBe(kind === 'redeem' ? 'redeemCompleteSet' : 'redeemShares')
			expect(decoded.args?.length ?? 0).toBe(kind === 'redeem' ? 1 : 0)
		})
	}

	test('complete-set issuance closes at question maturity while complete-set redemption remains available', () => {
		const { snapshot, pool } = fixture()
		const question = snapshot.questions[0]
		if (question === undefined) throw new Error('Missing question fixture')
		pool.additionalMintCapacityAttoEth = '10000000000000000000'
		question.endTime = (BigInt(snapshot.anchor.timestamp) + 1_000n).toString()
		pool.purchaseQuote = { spender: pool.coordinator, mintAttoEth: 1000n.toString(), feeAttoEth: 100n.toString(), premiumAttoEth: 200n.toString(), minimumShares: '1000' }
		const mint = completeSetDefinition('create')
		expect(mint.buildPlan(snapshot, options)?.deadlineTimestamp).toBe((BigInt(question.endTime) - 1n).toString())
		question.endTime = (BigInt(snapshot.anchor.timestamp) + 1n).toString()
		expect(mint.buildPlan(snapshot, options)).toBeUndefined()
		question.endTime = snapshot.anchor.timestamp
		expect(mint.buildPlan(snapshot, options)).toBeUndefined()
		expect(mint.evaluate(snapshot, options).eligible).toBe(false)
		pool.projectedSettlementCollateralAttoEth = pool.shareTokenSupplyAttoShares
		expect(completeSetDefinition('redeem').buildPlan(snapshot, options)?.steps).toHaveLength(1)
	})
})
