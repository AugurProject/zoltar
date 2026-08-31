import { describe, expect, test } from 'bun:test'
import { erc20Abi, escalationGameAbi, openOracleAbi, securityPoolAbi, zoltarAbi } from '../../src/contracts/abi.ts'
import { eligibleOperationPlans, reevaluateOperationContinuation } from '../../src/operations/catalog.ts'
import type { EcosystemSnapshot, OperationPlan } from '../../src/operations/types.ts'
import { decodeFunctionData } from '../support/bot-shared.ts'
import { address, hash, snapshotFixture } from './fixture.ts'

const options = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	maximumBlockIntervalSeconds: 15,
	maximumGasCostAttoEth: (10n ** 14n).toString(),
	maxEthSpendAttoEth: (10n ** 15n).toString(),
	maxRepSpendAttoRep: (10n ** 15n).toString(),
	minimumEthReserveAttoEth: (10n ** 16n).toString(),
	minimumRepReserveAttoRep: (10n ** 18n).toString(),
	seed: 2,
} as const

function requiredPlan(snapshot: EcosystemSnapshot, definitionId: string, planningOptions = options) {
	const plan = eligibleOperationPlans(snapshot, planningOptions).find(candidate => candidate.definitionId === definitionId)
	if (plan === undefined) throw new Error(`Missing ${definitionId} plan`)
	return plan
}

function action(plan: OperationPlan) {
	const step = plan.steps.at(-1)
	if (step === undefined) throw new Error(`Missing ${plan.definitionId} action`)
	return step
}

function approvalSteps(plan: OperationPlan) {
	return plan.steps.filter(step => step.id.startsWith('approve-'))
}

function confirmApproval(snapshot: EcosystemSnapshot, step: OperationPlan['steps'][number]) {
	const call = decodeFunctionData({ abi: erc20Abi, data: step.data })
	if (call.functionName !== 'approve') throw new Error(`Expected ${step.id} to be an ERC-20 approval`)
	const [spender, required] = call.args
	const inventory = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === step.to.toLowerCase())
	if (inventory === undefined) throw new Error(`Missing inventory for ${step.id}`)
	inventory.allowances[spender] = required.toString()
	const escalationPool = snapshot.pools.find(pool => pool.escalationGame.toLowerCase() === spender.toLowerCase())
	if (escalationPool !== undefined) {
		for (const quote of escalationPool.directEscalationDepositQuotes) quote.mutationExpectedSuccess = true
	}
	return step.id
}

function confirmAllApprovals(snapshot: EcosystemSnapshot, plan: OperationPlan) {
	return approvalSteps(plan).map(step => confirmApproval(snapshot, step))
}

function continuation(snapshot: EcosystemSnapshot, plan: OperationPlan, confirmedStepIds: readonly string[], planningOptions = options, continuationDisposition?: 'cleanup-only') {
	return reevaluateOperationContinuation(snapshot, plan, planningOptions, {
		confirmedStepIds,
		...(continuationDisposition === undefined ? {} : { continuationDisposition }),
	}).plan
}

function expectOnlyExactRevokes(plan: OperationPlan | undefined, expected: Array<{ spender: `0x${string}`; token: `0x${string}` }>) {
	if (plan === undefined) throw new Error('Expected a revoke-only cleanup plan')
	expect(plan.continuationDisposition).toBe('cleanup-only')
	expect(plan.maximumCleanupTransactionCount).toBeUndefined()
	expect(plan.steps).toHaveLength(expected.length)
	for (const [index, step] of plan.steps.entries()) {
		const expectedRevoke = expected[index]
		if (expectedRevoke === undefined) throw new Error('Missing expected revoke')
		const call = decodeFunctionData({ abi: erc20Abi, data: step.data })
		expect(call.functionName).toBe('approve')
		expect(call.args).toEqual([expectedRevoke.spender, 0n])
		expect(step.to).toBe(expectedRevoke.token)
	}
}

function disputeSnapshot() {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Dispute fixture is missing its pool')
	pool.pendingReportId = '42'
	snapshot.reports.push({
		currentAmount1: '1000',
		currentAmount2: '1000',
		currentReporter: pool.coordinator,
		disputeAfterTimestamp: '1999999560',
		disputeBeforeTimestamp: '2000003500',
		disputeDelay: '60',
		escalationHalt: '100000',
		flags: 7,
		game: { callbackContract: pool.coordinator, callbackGasLimit: 500000, feePercentage: 0, lastReportOppoTime: '1', numReports: 1, protocolFee: 0, protocolFeeRecipient: address(30), settlerReward: '0' },
		helper: { blockNumber: '99', blockTimestamp: '1999999500', creator: pool.coordinator },
		multiplier: 140,
		openOracle: snapshot.deployments.openOracle,
		reportId: '42',
		reportTimestamp: '1999999500',
		settlementTime: '4000',
		settlementTimestamp: '0',
		stateHash: hash(42),
		token1: snapshot.deployments.weth,
		token2: pool.repToken,
	})
	return snapshot
}

describe('non-Trading exact approval continuations', () => {
	test('keeps persisted principal exact after inbound inventory for every approval workflow', () => {
		const cases: Array<{
			abi: typeof openOracleAbi | typeof zoltarAbi | typeof securityPoolAbi | typeof escalationGameAbi
			definitionId: string
			prepare(snapshot: EcosystemSnapshot): void
		}> = [
			{ abi: openOracleAbi, definitionId: 'open-oracle.deposit', prepare: () => undefined },
			{ abi: openOracleAbi, definitionId: 'open-oracle.report', prepare: () => undefined },
			{
				abi: zoltarAbi,
				definitionId: 'zoltar.universe.fork',
				prepare(snapshot) {
					const universe = snapshot.universes[0]
					if (universe === undefined) throw new Error('Missing fork universe')
					universe.forkThresholdAttoRep = '1000'
				},
			},
			{
				abi: zoltarAbi,
				definitionId: 'zoltar.migration.add',
				prepare(snapshot) {
					const universe = snapshot.universes[0]
					if (universe === undefined) throw new Error('Missing migration universe')
					universe.forkTime = '1'
				},
			},
			{ abi: zoltarAbi, definitionId: 'zoltar.rep.burn', prepare: () => undefined },
			{ abi: securityPoolAbi, definitionId: 'statoblast.vault.deposit-rep', prepare: () => undefined },
			{ abi: escalationGameAbi, definitionId: 'statoblast.escalation.deposit-wallet-rep', prepare: () => undefined },
		]

		for (const candidate of cases) {
			const snapshot = snapshotFixture()
			candidate.prepare(snapshot)
			const original = requiredPlan(snapshot, candidate.definitionId)
			const originalAction = decodeFunctionData({ abi: candidate.abi, data: action(original).data })
			const originalApprovals = approvalSteps(original)
			expect(original.maximumCleanupTransactionCount, candidate.definitionId).toBe(originalApprovals.length)
			const confirmedStepIds = confirmAllApprovals(snapshot, original)
			expect(confirmedStepIds.length, candidate.definitionId).toBeGreaterThan(0)
			for (const token of snapshot.wallet.tokens) token.balance = (BigInt(token.balance) + 10n ** 24n).toString()
			const rebuilt = continuation(snapshot, original, confirmedStepIds)
			if (rebuilt === undefined) throw new Error(`Missing ${candidate.definitionId} continuation`)
			expect(decodeFunctionData({ abi: candidate.abi, data: action(rebuilt).data }).args, candidate.definitionId).toEqual(originalAction.args)
			expect(action(rebuilt).walletAssetDebits, candidate.definitionId).toEqual(action(original).walletAssetDebits)
			expect(rebuilt.maximumCleanupTransactionCount, candidate.definitionId).toBe(confirmedStepIds.length)
			expect(
				rebuilt.steps.every(step => !confirmedStepIds.includes(step.id)),
				candidate.definitionId,
			).toBeTrue()
			const expectedRevokes = originalApprovals.map(step => {
				const call = decodeFunctionData({ abi: erc20Abi, data: step.data })
				if (call.functionName !== 'approve') throw new Error(`Expected ${step.id} approval`)
				return { spender: call.args[0], token: step.to }
			})
			expectOnlyExactRevokes(continuation(snapshot, original, confirmedStepIds, { ...options, maxEthSpendAttoEth: 0n.toString(), maxRepSpendAttoRep: 0n.toString() }), expectedRevokes)
			expectOnlyExactRevokes(continuation(snapshot, original, confirmedStepIds, options, 'cleanup-only'), expectedRevokes)
		}
	})

	test('falls back to exact revoke-only cleanup when balances or policy caps shrink', () => {
		const snapshot = snapshotFixture()
		const original = requiredPlan(snapshot, 'open-oracle.deposit')
		const approval = approvalSteps(original)[0]
		if (approval === undefined) throw new Error('Missing OpenOracle deposit approval')
		const confirmed = confirmApproval(snapshot, approval)
		const token = snapshot.wallet.tokens.find(candidate => candidate.address.toLowerCase() === approval.to.toLowerCase())
		if (token === undefined) throw new Error('Missing deposited token')
		token.balance = '0'
		expectOnlyExactRevokes(continuation(snapshot, original, [confirmed]), [{ spender: snapshot.deployments.openOracle, token: approval.to }])

		const zoltarSnapshot = snapshotFixture()
		const burn = requiredPlan(zoltarSnapshot, 'zoltar.rep.burn')
		const burnApproval = approvalSteps(burn)[0]
		if (burnApproval === undefined) throw new Error('Missing REP burn approval')
		const burnConfirmed = confirmApproval(zoltarSnapshot, burnApproval)
		expectOnlyExactRevokes(continuation(zoltarSnapshot, burn, [burnConfirmed], { ...options, maxRepSpendAttoRep: 0n.toString() }), [{ spender: zoltarSnapshot.deployments.zoltar, token: burnApproval.to }])

		const poolSnapshot = snapshotFixture()
		const deposit = requiredPlan(poolSnapshot, 'statoblast.vault.deposit-rep')
		const poolApproval = approvalSteps(deposit)[0]
		if (poolApproval === undefined) throw new Error('Missing vault approval')
		const poolConfirmed = confirmApproval(poolSnapshot, poolApproval)
		const pool = poolSnapshot.pools[0]
		if (pool === undefined) throw new Error('Missing vault pool')
		pool.minimumSafeWalletVaultDepositAttoRep = (BigInt(String(deposit.metadata['amountAttoRep'])) + 1n).toString()
		expectOnlyExactRevokes(continuation(poolSnapshot, deposit, [poolConfirmed]), [{ spender: pool.address, token: poolApproval.to }])

		const directSnapshot = snapshotFixture()
		const direct = requiredPlan(directSnapshot, 'statoblast.escalation.deposit-wallet-rep')
		const directApproval = approvalSteps(direct)[0]
		if (directApproval === undefined) throw new Error('Missing direct escalation approval')
		const directConfirmed = confirmApproval(directSnapshot, directApproval)
		directSnapshot.pools[0]?.directEscalationDepositQuotes.forEach(quote => {
			quote.mutationExpectedSuccess = false
		})
		expectOnlyExactRevokes(continuation(directSnapshot, direct, [directConfirmed]), [{ spender: directSnapshot.pools[0]?.escalationGame ?? address(0), token: directApproval.to }])
	})

	test('does not reuse a confirmed approval step identity after its allowance is externally spent', () => {
		const snapshot = snapshotFixture()
		const original = requiredPlan(snapshot, 'open-oracle.deposit')
		const approval = approvalSteps(original)[0]
		if (approval === undefined) throw new Error('Missing OpenOracle deposit approval')
		const confirmed = confirmApproval(snapshot, approval)
		const inventory = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === approval.to.toLowerCase())
		if (inventory === undefined) throw new Error('Missing approved token')
		inventory.allowances[snapshot.deployments.openOracle] = '0'
		const cleanup = continuation(snapshot, original, [confirmed])
		expectOnlyExactRevokes(cleanup, [{ spender: snapshot.deployments.openOracle, token: approval.to }])
		expect(cleanup?.steps[0]?.id).not.toBe(approval.id)
	})

	test('keeps a dispute quote exact after inbound wallet inventory', () => {
		const snapshot = disputeSnapshot()
		const original = requiredPlan(snapshot, 'open-oracle.dispute')
		const originalCall = decodeFunctionData({ abi: openOracleAbi, data: action(original).data })
		const confirmed = confirmAllApprovals(snapshot, original)
		for (const token of snapshot.wallet.tokens) token.balance = (BigInt(token.balance) + 10n ** 24n).toString()
		const rebuilt = continuation(snapshot, original, confirmed)
		if (rebuilt === undefined) throw new Error('Missing exact dispute continuation')
		expect(decodeFunctionData({ abi: openOracleAbi, data: action(rebuilt).data }).args).toEqual(originalCall.args)
		expect(action(rebuilt).walletAssetDebits).toEqual(action(original).walletAssetDebits)
		expect(rebuilt.maximumCleanupTransactionCount).toBe(confirmed.length)
	})

	test('revokes the persisted spender when a canonical target changes', () => {
		const snapshot = snapshotFixture()
		const originalOpenOracle = snapshot.deployments.openOracle
		const original = requiredPlan(snapshot, 'open-oracle.deposit')
		const approval = approvalSteps(original)[0]
		if (approval === undefined) throw new Error('Missing OpenOracle approval')
		const confirmed = confirmApproval(snapshot, approval)
		snapshot.deployments.openOracle = address(90)
		expectOnlyExactRevokes(continuation(snapshot, original, [confirmed]), [{ spender: originalOpenOracle, token: approval.to }])

		const zoltarSnapshot = snapshotFixture()
		const originalZoltar = zoltarSnapshot.deployments.zoltar
		const burn = requiredPlan(zoltarSnapshot, 'zoltar.rep.burn')
		const burnApproval = approvalSteps(burn)[0]
		if (burnApproval === undefined) throw new Error('Missing Zoltar approval')
		const burnConfirmed = confirmApproval(zoltarSnapshot, burnApproval)
		zoltarSnapshot.deployments.zoltar = address(91)
		expectOnlyExactRevokes(continuation(zoltarSnapshot, burn, [burnConfirmed]), [{ spender: originalZoltar, token: burnApproval.to }])

		const directSnapshot = snapshotFixture()
		const directPool = directSnapshot.pools[0]
		if (directPool === undefined) throw new Error('Missing direct escalation pool')
		const originalGame = directPool.escalationGame
		const direct = requiredPlan(directSnapshot, 'statoblast.escalation.deposit-wallet-rep')
		const directApproval = approvalSteps(direct)[0]
		if (directApproval === undefined) throw new Error('Missing direct escalation approval')
		const directConfirmed = confirmApproval(directSnapshot, directApproval)
		directPool.escalationGame = address(92)
		expectOnlyExactRevokes(continuation(directSnapshot, direct, [directConfirmed]), [{ spender: originalGame, token: directApproval.to }])
	})

	test('revokes the direct escalation approval when the persisted action is tampered', () => {
		const snapshot = snapshotFixture()
		const direct = requiredPlan(snapshot, 'statoblast.escalation.deposit-wallet-rep')
		const approval = approvalSteps(direct)[0]
		if (approval === undefined) throw new Error('Missing direct escalation approval')
		const confirmed = confirmApproval(snapshot, approval)
		const action = direct.steps.find(step => step.id === 'deposit-wallet-rep')
		if (action === undefined) throw new Error('Missing direct escalation action')
		action.data = '0x1234'
		expectOnlyExactRevokes(continuation(snapshot, direct, [confirmed]), [{ spender: snapshot.pools[0]?.escalationGame ?? address(0), token: approval.to }])
	})

	test('revokes the direct escalation approval when an intervening deposit fills the threshold', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Missing direct escalation pool')
		const direct = requiredPlan(snapshot, 'statoblast.escalation.deposit-wallet-rep')
		const approval = approvalSteps(direct)[0]
		if (approval === undefined) throw new Error('Missing direct escalation approval')
		const confirmed = confirmApproval(snapshot, approval)
		const outcome = direct.metadata['outcome']
		if (typeof outcome !== 'number') throw new Error('Missing direct escalation outcome')
		pool.escalationOutcomeBalancesAttoRep[outcome] = pool.escalationNonDecisionThresholdAttoRep
		pool.directEscalationDepositQuotes[outcome] = {
			acceptedAmountAttoRep: 0n.toString(),
			maximumDepositAttoRep: 0n.toString(),
			mutationExpectedSuccess: false,
			resultingCumulativeAmountAttoRep: 0n.toString(),
		}
		expectOnlyExactRevokes(continuation(snapshot, direct, [confirmed]), [{ spender: pool.escalationGame, token: approval.to }])
	})

	test('cleans up only confirmed workflow-created approvals after terminal invalidation', () => {
		const snapshot = disputeSnapshot()
		const dispute = requiredPlan(snapshot, 'open-oracle.dispute')
		const approvals = approvalSteps(dispute)
		if (approvals.length < 2 || approvals[0] === undefined) throw new Error('Expected two dispute approvals')
		const confirmed = confirmApproval(snapshot, approvals[0])
		const report = snapshot.reports[0]
		if (report === undefined) throw new Error('Missing disputed report')
		report.stateHash = hash(99)
		expectOnlyExactRevokes(continuation(snapshot, dispute, [confirmed]), [{ spender: snapshot.deployments.openOracle, token: approvals[0].to }])
		expectOnlyExactRevokes(continuation(snapshot, dispute, [confirmed], options, 'cleanup-only'), [{ spender: snapshot.deployments.openOracle, token: approvals[0].to }])

		const forkSnapshot = snapshotFixture()
		const universe = forkSnapshot.universes[0]
		if (universe === undefined) throw new Error('Missing fork universe')
		universe.forkThresholdAttoRep = '1000'
		const fork = requiredPlan(forkSnapshot, 'zoltar.universe.fork')
		const forkApproval = approvalSteps(fork)[0]
		if (forkApproval === undefined) throw new Error('Missing fork approval')
		const forkConfirmed = confirmApproval(forkSnapshot, forkApproval)
		universe.forkTime = '1'
		expectOnlyExactRevokes(continuation(forkSnapshot, fork, [forkConfirmed], options, 'cleanup-only'), [{ spender: forkSnapshot.deployments.zoltar, token: forkApproval.to }])
	})
})
