import { describe, expect, test } from 'bun:test'
import { type Address, zeroHash } from '@zoltar/core-shared/evm/ethereum'
import { planPortfolioAllocations } from './securityPoolPortfolioPlanning.js'
import type { PortfolioPosition, PortfolioSnapshot } from './securityPoolPortfolioRead.js'

const account: Address = '0x0000000000000000000000000000000000000001'
const other: Address = '0x0000000000000000000000000000000000000002'
const position: PortfolioPosition = {
	questionId: 1n,
	universeId: 0n,
	pool: account,
	registered: true,
	repToken: account,
	coordinator: account,
	priceFeed: account,
	pendingReportCoordinator: account,
	backingUnits: 0n,
	backingAttoRep: 0n,
	commitmentAttoEth: 0n,
	claimableFeesAttoEth: 100n,
	openInterestAttoEth: 0n,
	badDebtAttoEth: 0n,
	disputeStakeAttoRep: 0n,
	ordinaryResidualPending: false,
	poolHeldAttoRep: 0n,
	totalBackingUnits: 0n,
	poolCommitmentAttoEth: 0n,
	settlementCollateralAttoEth: 0n,
	securityMultiplierBps: 20_000n,
	minimumDepositAttoRep: 1n,
	systemState: 0n,
	resolved: false,
	questionEndTime: 1000n,
	forkTime: 0n,
	price: 10n ** 18n,
	priceValid: true,
	pendingReportId: 0n,
	settlementTime: 60n,
	queuedOperations: [],
	queuedOperationsComplete: true,
	allocationOperationsComplete: true,
}
function parameters(overrides: Partial<PortfolioPosition> = {}) {
	const snapshot: PortfolioSnapshot = {
		chainId: 1,
		blockNumber: 1n,
		blockHash: zeroHash,
		timestamp: 100n,
		portfolio: account,
		vault: account,
		owner: other,
		originUniverseId: 0n,
		questions: [1n, 2n],
		coverage: { complete: true, issues: [], scope: 'registered-and-explicit-pools', registryComplete: true },
		branches: [
			{
				universeId: 0n,
				repToken: account,
				idleAttoRep: 100n,
				forkTime: 0n,
				positions: [
					{ ...position, ...overrides },
					{ ...position, questionId: 2n, pool: other },
				],
			},
			{ universeId: 1n, repToken: other, idleAttoRep: 10_000n, forkTime: 0n, positions: [] },
		],
	}
	return { snapshot, universeId: 0n, minimumIdleAttoRep: 10n, minimumHealthFactorBps: 10_000n, allocations: [{ questionId: 1n, depositAttoRep: 40n, commitmentAttoEth: 20n }] }
}

describe('conservative portfolio allocation planner', () => {
	test('uses actual idle REP once across a question batch and retains a real reserve', () => {
		const base = parameters()
		const plan = planPortfolioAllocations({ ...base, allocations: [...base.allocations, { questionId: 2n, depositAttoRep: 50n, commitmentAttoEth: 25n }] })
		expect(plan.idleAfterAttoRep).toBe(10n)
		expect(plan.requireImmediate).toBe(true)
		expect(plan.operations.every(operation => operation.input.withdrawAttoRep === 0n && operation.value === 0n)).toBe(true)
		expect(() => planPortfolioAllocations({ ...base, allocations: [...base.allocations, { questionId: 2n, depositAttoRep: 51n, commitmentAttoEth: 25n }] })).toThrow('actual idle REP')
	})

	test('does not use child REP, fees, dispute escrow, or proposed exits as liquid balance', () => {
		const base = parameters({ disputeStakeAttoRep: 500n })
		expect(() => planPortfolioAllocations({ ...base, allocations: [{ questionId: 1n, depositAttoRep: 91n, commitmentAttoEth: 1n }] })).toThrow('actual idle REP')
		expect(() => planPortfolioAllocations({ ...parameters(), universeId: 1n })).toThrow('no registered pool')
	})

	test('checks both health constraints, including the unescrowed REP minimum', () => {
		const base = parameters({ disputeStakeAttoRep: 1000n })
		expect(() => planPortfolioAllocations({ ...base, allocations: [{ questionId: 1n, depositAttoRep: 29n, commitmentAttoEth: 20n }] })).toThrow('health buffer')
		expect(planPortfolioAllocations({ ...base, allocations: [{ questionId: 1n, depositAttoRep: 30n, commitmentAttoEth: 20n }] }).previews[0]?.backingAfterAttoRep).toBe(30n)
		expect(() => planPortfolioAllocations({ ...parameters(), minimumHealthFactorBps: 12_000n })).toThrow('health buffer')
	})

	test('models minted backing units exactly instead of adding deposit to rounded old backing', () => {
		const base = parameters({ backingUnits: 1n, totalBackingUnits: 3n, poolHeldAttoRep: 10n, backingAttoRep: 3n, securityMultiplierBps: 10_000n })
		const plan = planPortfolioAllocations({ ...base, allocations: [{ questionId: 1n, depositAttoRep: 4n, commitmentAttoEth: 0n }] })
		expect(plan.previews[0]?.backingAfterAttoRep).toBe(7n)
		expect(() => planPortfolioAllocations({ ...base, allocations: [{ questionId: 1n, depositAttoRep: 1n, commitmentAttoEth: 0n }] })).toThrow('no backing units')
	})

	test('uses nested ceiling division at tiny values', () => {
		const base = parameters({ price: 1n, securityMultiplierBps: 10_001n })
		expect(() => planPortfolioAllocations({ ...base, allocations: [{ questionId: 1n, depositAttoRep: 1n, commitmentAttoEth: 1n }] })).toThrow('health buffer')
		expect(planPortfolioAllocations({ ...base, allocations: [{ questionId: 1n, depositAttoRep: 2n, commitmentAttoEth: 1n }] }).previews[0]?.backingAfterAttoRep).toBe(2n)
	})

	test('rejects stale, forked, ended, resolved, pending and incomplete snapshots', () => {
		for (const override of [
			{ priceValid: false },
			{ pendingReportId: 1n },
			{ forkTime: 1n },
			{ resolved: true },
			{ questionEndTime: 100n },
			{ systemState: 2n },
			{ allocationOperationsComplete: false },
			{ queuedOperations: [{ operationId: 1n, operationType: 1n, operator: account, receiverVault: account, targetVault: account, queuedAt: 0n, validForSeconds: 1n }] },
		])
			expect(() => planPortfolioAllocations(parameters(override))).toThrow()
	})

	test('explicit selected coverage does not require scanning unrelated permissionless registry entries', () => {
		const base = parameters()
		base.snapshot.coverage.registryComplete = false
		expect(() => planPortfolioAllocations(base)).not.toThrow()
	})

	test('incomplete unrelated coverage never supplies missing questions, branches, or idle REP', () => {
		const base = parameters()
		base.snapshot.coverage.complete = false
		expect(planPortfolioAllocations(base).idleAfterAttoRep).toBe(60n)
		expect(() => planPortfolioAllocations({ ...base, universeId: 2n })).toThrow('was not read')
		expect(() => planPortfolioAllocations({ ...base, allocations: [{ questionId: 3n, depositAttoRep: 40n, commitmentAttoEth: 20n }] })).toThrow('no registered pool')
		expect(() => planPortfolioAllocations({ ...base, allocations: [{ questionId: 1n, depositAttoRep: 91n, commitmentAttoEth: 1n }] })).toThrow('actual idle REP')
	})

	test('an unsolicited incoming liquidation cannot prevent an immediate rescue allocation', () => {
		const incoming = { operationId: 1n, operationType: 0n, operator: other, receiverVault: other, targetVault: account, queuedAt: 0n, validForSeconds: 300n }
		expect(planPortfolioAllocations(parameters({ queuedOperations: [incoming] })).idleAfterAttoRep).toBe(60n)
		for (const authorized of [
			{ ...incoming, operator: account },
			{ ...incoming, receiverVault: account },
			{ ...incoming, operationType: 3n },
		])
			expect(() => planPortfolioAllocations(parameters({ queuedOperations: [authorized] }))).toThrow('pending operations')
	})

	test('receiver-only operations stop blocking strictly after expiry, while owner cleanup remains required', () => {
		const incoming = { operationId: 1n, operationType: 0n, operator: other, receiverVault: account, targetVault: other, queuedAt: 0n, validForSeconds: 40n }
		const atExpiry = parameters({ queuedOperations: [incoming] })
		expect(() => planPortfolioAllocations(atExpiry)).toThrow('pending operations')
		atExpiry.snapshot.timestamp = 101n
		expect(planPortfolioAllocations(atExpiry).idleAfterAttoRep).toBe(60n)
		const ownerOperation = parameters({ queuedOperations: [{ ...incoming, operator: account }] })
		ownerOperation.snapshot.timestamp = 101n
		expect(() => planPortfolioAllocations(ownerOperation)).toThrow('pending operations')
	})

	test('rejects duplicate questions, reductions, no-ops and invalid buffers', () => {
		const base = parameters()
		expect(() => planPortfolioAllocations({ ...base, allocations: [...base.allocations, ...base.allocations] })).toThrow('once per batch')
		expect(() => planPortfolioAllocations(parameters({ commitmentAttoEth: 21n }))).toThrow('cannot reduce')
		expect(() => planPortfolioAllocations({ ...base, allocations: [{ questionId: 1n, depositAttoRep: 0n, commitmentAttoEth: 0n }] })).toThrow('Choose a deposit')
		expect(() => planPortfolioAllocations({ ...base, minimumHealthFactorBps: 9999n })).toThrow('10000')
	})
})
