import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, encodeAbiParameters, zeroHash } from '../support/bot-shared.ts'
import { securityPoolAbi } from '../../src/contracts/abi.ts'
import { canonicalLifecyclePresence, eligibleOperationPlans, evaluateOperationCatalog, urgentOperationPlans } from '../../src/operations/catalog.ts'
import type { StagedOperationSnapshot } from '../../src/operations/types.ts'
import { address, snapshotFixture } from './fixture.ts'

const options = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	maxEthSpendAttoEth: 1_000n.toString(),
	maxRepSpendAttoRep: 1_000n.toString(),
	minimumEthReserveAttoEth: 0n.toString(),
	minimumRepReserveAttoRep: 0n.toString(),
	seed: 0x1357_2468,
} as const

function stagedFixture(operation: 0 | 1): { pool: ReturnType<typeof snapshotFixture>['pools'][number]; snapshot: ReturnType<typeof snapshotFixture>; staged: StagedOperationSnapshot } {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Pool fixture missing')
	const liquidationResult = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [80n, 20n, 0n])
	const staged: StagedOperationSnapshot = {
		amount: '100',
		coordinator: pool.coordinator,
		executionExpectedResult: operation === 0 ? liquidationResult : '0x',
		executionExpectedSuccess: true,
		id: '42',
		isPendingSettlement: false,
		liquidationApprovalId: zeroHash,
		liquidationMinimumReceiverHealthFactorBps: operation === 0 ? '10000' : '0',
		liquidationMinPriceDistanceBps: operation === 0 ? '250' : '0',
		operation,
		operator: snapshot.wallet.address,
		queuedAt: '1999999000',
		receiverVault: snapshot.wallet.address,
		reservedLiquidationDebtAttoEth: 0n.toString(),
		snapshotTargetBackingUnits: '10',
		snapshotTargetCapacityOwnershipAttoRep: 20n.toString(),
		snapshotTargetDisputeStakedAttoRep: 0n.toString(),
		snapshotTargetOpenInterestAttoEth: operation === 0 ? '100' : '0',
		snapshotTotalPoolHeldAttoRep: 1_000n.toString(),
		snapshotTotalRepBackingUnits: '900',
		targetVault: operation === 0 ? address(88) : snapshot.wallet.address,
		validForSeconds: '3600',
	}
	snapshot.stagedOperations.push(staged)
	return { pool, snapshot, staged }
}

describe('safe liquidation operations', () => {
	test('excludes the unguarded self-receiver liquidation queue from unattended planning', () => {
		const snapshot = snapshotFixture()
		const evaluation = evaluateOperationCatalog(snapshot, options).find(candidate => candidate.definition.id === 'statoblast.liquidation.queue')
		expect(evaluation?.definition.classification).toBe('excluded-dangerous')
		expect(evaluation?.eligibility.eligible).toBe(false)
		expect(evaluation?.eligibility.blockers.join(' ')).toContain('bad debt')
		expect(eligibleOperationPlans(snapshot, options).some(candidate => candidate.definitionId === 'statoblast.liquidation.queue')).toBe(false)
	})

	test('excludes operation 0 execution and attaches an exact downstream preflight for operation 1 withdrawal', () => {
		const liquidation = stagedFixture(0)
		expect(urgentOperationPlans(liquidation.snapshot, options).find(candidate => candidate.definitionId === 'statoblast.staged.execute')).toBeUndefined()
		const excluded = evaluateOperationCatalog(liquidation.snapshot, options).find(candidate => candidate.definition.id === 'statoblast.staged.execute-liquidation-excluded')
		expect(excluded?.definition.classification).toBe('excluded-dangerous')
		expect(excluded?.eligibility.blockers.join(' ')).toContain('cannot bind')
		expect(canonicalLifecyclePresence(liquidation.snapshot, options).filter(candidate => candidate.metadata['operationId'] === liquidation.staged.id)).toEqual([
			{ definitionId: 'statoblast.staged.expire', ecosystem: 'statoblast', metadata: { coordinator: liquidation.staged.coordinator, operationId: liquidation.staged.id, operationType: 0 } },
		])

		const withdrawal = stagedFixture(1)
		const withdrawalPlan = urgentOperationPlans(withdrawal.snapshot, options).find(candidate => candidate.definitionId === 'statoblast.staged.execute')
		const withdrawalCall = withdrawalPlan?.steps[0]?.preflightCalls[0]
		if (withdrawalCall === undefined) throw new Error('Staged withdrawal preflight missing')
		expect(withdrawalPlan?.deadlineTimestamp).toBe('2000000200')
		expect(withdrawalCall.expectedResult).toBe('0x')
		expect(decodeFunctionData({ abi: securityPoolAbi, data: withdrawalCall.data })).toEqual({ args: [withdrawal.snapshot.wallet.address, 100n], functionName: 'withdrawRepFromVault' })

		const pool = withdrawal.snapshot.pools[0]
		if (pool === undefined) throw new Error('Withdrawal pool missing')
		pool.lastOracleSettlementTimestamp = (BigInt(withdrawal.snapshot.anchor.timestamp) - 181n).toString()
		pool.oraclePriceValid = true
		expect(urgentOperationPlans(withdrawal.snapshot, options).find(candidate => candidate.definitionId === 'statoblast.staged.execute')).toBeUndefined()
	})

	test('keeps stable staged identities and raw presence while execution is stale or fails simulation', () => {
		const { snapshot, staged } = stagedFixture(1)
		const first = urgentOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.staged.execute')
		if (first === undefined) throw new Error('Initial staged execution plan missing')
		expect(first.metadata).toEqual({ coordinator: staged.coordinator, operationId: '42', operationType: 1 })
		snapshot.anchor = { ...snapshot.anchor, blockNumber: '101' }
		const second = urgentOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.staged.execute')
		expect(second?.metadata).toEqual(first.metadata)

		staged.executionExpectedSuccess = false
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		pool.oraclePriceValid = false
		expect(urgentOperationPlans(snapshot, options).some(candidate => candidate.definitionId === 'statoblast.staged.execute')).toBe(false)
		const presence = canonicalLifecyclePresence(snapshot, options).filter(candidate => candidate.metadata['operationId'] === '42')
		expect(presence).toEqual([
			{ definitionId: 'statoblast.staged.execute', ecosystem: 'statoblast', metadata: first.metadata },
			{ definitionId: 'statoblast.staged.expire', ecosystem: 'statoblast', metadata: first.metadata },
		])
	})
})
