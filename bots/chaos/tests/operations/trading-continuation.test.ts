import { describe, expect, test } from 'bun:test'
import { erc1155Abi, twoWayConstantProductPairAbi } from '@zoltar/bot-shared/contracts/abi'
import { reevaluateOperationContinuation } from '../../src/operations/catalog.ts'
import { eligibleOperationPlans } from '../support/operation-plans.ts'
import type { OperationPlan } from '../../src/operations/types.ts'
import { createDurableWorkflow, durableWorkflowPlan, markWorkflowStepConfirmed, refreshWorkflowContinuation } from '../../src/runtime/workflows.ts'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { address, hash, snapshotFixture } from './fixture.ts'

const options = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	maximumBlockIntervalSeconds: 15,
	maxEthSpendAttoEth: (10n ** 15n).toString(),
	maxRepSpendAttoRep: (10n ** 15n).toString(),
	minimumEthReserveAttoEth: (10n ** 16n).toString(),
	minimumRepReserveAttoRep: (10n ** 18n).toString(),
	seed: 2,
} as const

function openTradingSnapshot() {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	const question = snapshot.questions[0]
	if (pool === undefined || question === undefined) throw new Error('Trading continuation fixture is incomplete')
	pool.shareTokenSupplyAttoShares = (10n ** 18n).toString()
	question.endTime = (BigInt(snapshot.anchor.timestamp) + 10_000n).toString()
	return snapshot
}

function requiredPlan(snapshot: ReturnType<typeof snapshotFixture>, definitionId: string) {
	const plan = eligibleOperationPlans(snapshot, options).find(candidate => candidate.definitionId === definitionId)
	if (plan === undefined) throw new Error(`Missing ${definitionId} plan`)
	return plan
}

function requiredAction(plan: OperationPlan) {
	const action = plan.steps.at(-1)
	if (action === undefined) throw new Error(`Missing ${plan.definitionId} action`)
	return action
}

function requiredBigint(value: unknown, label: string) {
	if (typeof value !== 'bigint') throw new Error(`${label} is not a bigint`)
	return value
}

function confirmShareApproval(snapshot: ReturnType<typeof snapshotFixture>, plan: OperationPlan, operator: `0x${string}`) {
	const approval = plan.steps.find(step => step.id === `approve-shares-${operator}`)
	if (approval === undefined) throw new Error(`Missing ${plan.definitionId} share approval`)
	const shares = snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === approval.to.toLowerCase())
	if (shares === undefined) throw new Error(`Missing ${plan.definitionId} share inventory`)
	shares.isApprovedForAll[operator] = true
	return approval.id
}

function exactContinuation(snapshot: ReturnType<typeof snapshotFixture>, plan: OperationPlan, confirmedStepId: string, continuationDisposition?: 'cleanup-only') {
	return reevaluateOperationContinuation(snapshot, plan, options, {
		confirmedStepIds: [confirmedStepId],
		...(continuationDisposition === undefined ? {} : { continuationDisposition }),
	}).plan
}

describe('trading exact continuations', () => {
	test('keeps direct liquidity share amounts exact after inbound inventory', () => {
		for (const definitionId of ['trading.pair.initialize-shares', 'trading.liquidity.add-shares'] as const) {
			const snapshot = openTradingSnapshot()
			const pair = snapshot.pairs[0]
			const shares = snapshot.wallet.shares[0]
			if (pair === undefined || shares === undefined) throw new Error('Direct liquidity fixture is incomplete')
			shares.yes = '5000'
			shares.no = '5000'
			if (definitionId === 'trading.pair.initialize-shares') {
				pair.status = 6
				pair.totalSupply = '0'
				pair.effectiveYesReserve = '0'
				pair.effectiveNoReserve = '0'
			}
			const original = requiredPlan(snapshot, definitionId)
			const originalArgs = decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: requiredAction(original).data }).args
			const confirmedStepId = confirmShareApproval(snapshot, original, pair.address)
			shares.yes = (10n ** 18n).toString()
			shares.no = (10n ** 18n).toString()

			const continuation = exactContinuation(snapshot, original, confirmedStepId)
			if (continuation === undefined) throw new Error(`Missing ${definitionId} continuation`)
			const continuationArgs = decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: requiredAction(continuation).data }).args
			expect(continuationArgs[0], definitionId).toBe(originalArgs[0])
			expect(continuationArgs[1], definitionId).toBe(originalArgs[1])
			expect(continuation.maximumCleanupTransactionCount, definitionId).toBe(1)
		}
	})

	test('keeps exact-input principal fixed and cleans up when source inventory falls', () => {
		const snapshot = openTradingSnapshot()
		const pair = snapshot.pairs[0]
		const shares = snapshot.wallet.shares[0]
		if (pair === undefined || shares === undefined) throw new Error('Swap continuation fixture is incomplete')
		shares.yes = '5000'
		shares.no = '0'
		const original = requiredPlan(snapshot, 'trading.swap.exact-input')
		const originalArgs = decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: requiredAction(original).data }).args
		const confirmedStepId = confirmShareApproval(snapshot, original, pair.address)
		shares.yes = (10n ** 18n).toString()

		const continuation = exactContinuation(snapshot, original, confirmedStepId)
		if (continuation === undefined) throw new Error('Missing exact-input continuation')
		const continuationArgs = decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: requiredAction(continuation).data }).args
		expect(continuationArgs[1]).toBe(originalArgs[1])
		expect(continuationArgs[2]).toBe(originalArgs[2])

		shares.yes = '0'
		const cleanup = exactContinuation(snapshot, original, confirmedStepId)
		if (cleanup === undefined) throw new Error('Missing exact-input cleanup')
		const cleanupCall = decodeFunctionData({ abi: erc1155Abi, data: requiredAction(cleanup).data })
		expect(cleanupCall.functionName).toBe('setApprovalForAll')
		expect(cleanupCall.args).toEqual([pair.address, false])
		expect(cleanup.continuationDisposition).toBe('cleanup-only')
		expect(cleanup.maximumCleanupTransactionCount).toBeUndefined()
	})

	test('does not raise an exact-output maximum input when live reserves worsen', () => {
		const snapshot = openTradingSnapshot()
		const pair = snapshot.pairs[0]
		const shares = snapshot.wallet.shares[0]
		if (pair === undefined || shares === undefined) throw new Error('Exact-output fixture is incomplete')
		shares.yes = '5000'
		shares.no = '0'
		const original = requiredPlan(snapshot, 'trading.swap.exact-output')
		const originalArgs = decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: requiredAction(original).data }).args
		const confirmedStepId = confirmShareApproval(snapshot, original, pair.address)
		shares.yes = (10n ** 18n).toString()
		const continuation = exactContinuation(snapshot, original, confirmedStepId)
		if (continuation === undefined) throw new Error('Missing exact-output continuation')
		const continuationArgs = decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: requiredAction(continuation).data }).args
		expect(continuationArgs[1]).toBe(originalArgs[1])
		expect(continuationArgs[2]).toBe(originalArgs[2])

		shares.yes = (requiredBigint(originalArgs[2], 'exact-output maximum input') - 1n).toString()
		const insufficientInventory = exactContinuation(snapshot, original, confirmedStepId)
		if (insufficientInventory === undefined) throw new Error('Missing exact-output inventory cleanup')
		expect(decodeFunctionData({ abi: erc1155Abi, data: requiredAction(insufficientInventory).data }).args).toEqual([pair.address, false])

		shares.yes = (10n ** 18n).toString()
		pair.effectiveYesReserve = (10n ** 24n).toString()

		const cleanup = exactContinuation(snapshot, original, confirmedStepId)
		if (cleanup === undefined) throw new Error('Missing exact-output cleanup')
		const cleanupCall = decodeFunctionData({ abi: erc1155Abi, data: requiredAction(cleanup).data })
		expect(originalArgs[2]).toBeGreaterThan(0n)
		expect(cleanupCall.args).toEqual([pair.address, false])
	})

	test('rejects persisted quantities that no longer match the prior terminal calldata', () => {
		const snapshot = openTradingSnapshot()
		const pair = snapshot.pairs[0]
		const shares = snapshot.wallet.shares[0]
		if (pair === undefined || shares === undefined) throw new Error('Metadata drift fixture is incomplete')
		shares.no = '0'
		const original = requiredPlan(snapshot, 'trading.swap.exact-input')
		const confirmedApproval = confirmShareApproval(snapshot, original, pair.address)
		const inputAmount = original.metadata['inputAmount']
		if (typeof inputAmount !== 'string') throw new Error('Exact-input metadata amount is missing')
		original.metadata['inputAmount'] = (BigInt(inputAmount) + 1n).toString()

		const cleanup = exactContinuation(snapshot, original, confirmedApproval)
		if (cleanup === undefined) throw new Error('Missing metadata-drift cleanup')
		expect(decodeFunctionData({ abi: erc1155Abi, data: requiredAction(cleanup).data }).args).toEqual([pair.address, false])
	})

	test('keeps position-exit amount, bounds, and route exact after inbound inventory', () => {
		const snapshot = openTradingSnapshot()
		const pair = snapshot.pairs[0]
		const shares = snapshot.wallet.shares[0]
		if (pair === undefined || shares === undefined) throw new Error('Position-exit fixture is incomplete')
		shares.no = '0'
		const original = requiredPlan(snapshot, 'trading.position.exit')
		const originalArgs = decodeFunctionData({ abi: erc1155Abi, data: requiredAction(original).data }).args
		shares.invalid = (10n ** 18n).toString()
		shares.yes = (10n ** 18n).toString()
		shares.no = (10n ** 18n).toString()

		const continuation = exactContinuation(snapshot, original, '')
		if (continuation === undefined) throw new Error('Missing position-exit continuation')
		const continuationArgs = decodeFunctionData({ abi: erc1155Abi, data: requiredAction(continuation).data }).args
		expect(continuationArgs.slice(0, 4)).toEqual(originalArgs.slice(0, 4))

		const transferredAmounts = originalArgs[3]
		if (!Array.isArray(transferredAmounts)) throw new Error('Position-exit transfer amounts are missing')
		shares.invalid = (requiredBigint(transferredAmounts[0], 'position-exit complete amount') - 1n).toString()
		expect(exactContinuation(snapshot, original, '')).toBeUndefined()
	})

	test('keeps receive-based and direct-removal principal exact after inbound inventory', () => {
		const redeemSnapshot = openTradingSnapshot()
		const redeemShares = redeemSnapshot.wallet.shares[0]
		if (redeemShares === undefined) throw new Error('Router redeem fixture is incomplete')
		redeemShares.invalid = '5000'
		redeemShares.yes = '5000'
		redeemShares.no = '5000'
		const redeem = requiredPlan(redeemSnapshot, 'trading.complete-set.redeem')
		const redeemArgs = decodeFunctionData({ abi: erc1155Abi, data: requiredAction(redeem).data }).args
		redeemShares.invalid = (10n ** 18n).toString()
		redeemShares.yes = (10n ** 18n).toString()
		redeemShares.no = (10n ** 18n).toString()
		redeemSnapshot.anchor = { ...redeemSnapshot.anchor, blockHash: hash(302), blockNumber: '101', timestamp: (BigInt(redeemSnapshot.anchor.timestamp) + 60n).toString() }
		const redeemContinuation = exactContinuation(redeemSnapshot, redeem, '')
		if (redeemContinuation === undefined) throw new Error('Missing router redeem continuation')
		const redeemContinuationArgs = decodeFunctionData({ abi: erc1155Abi, data: requiredAction(redeemContinuation).data }).args
		expect(redeemContinuationArgs[2]).toEqual(redeemArgs[2])
		expect(redeemContinuationArgs[3]).toEqual(redeemArgs[3])
		expect(BigInt(redeemContinuation.deadlineTimestamp ?? '0')).toBeGreaterThan(BigInt(redeem.deadlineTimestamp ?? '0'))

		const removeSnapshot = openTradingSnapshot()
		const pair = removeSnapshot.pairs[0]
		const lp = removeSnapshot.wallet.lpTokens[0]
		if (pair === undefined || lp === undefined) throw new Error('Router remove fixture is incomplete')
		pair.walletLiquidity = '5000'
		lp.balance = '5000'
		lp.allowanceToRouter = '0'
		const remove = requiredPlan(removeSnapshot, 'trading.liquidity.remove')
		const removeArgs = decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: requiredAction(remove).data }).args
		pair.walletLiquidity = (10n ** 18n).toString()
		lp.balance = (10n ** 18n).toString()
		const removeContinuation = exactContinuation(removeSnapshot, remove, '')
		if (removeContinuation === undefined) throw new Error('Missing router remove continuation')
		expect(decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: requiredAction(removeContinuation).data }).args[0]).toBe(removeArgs[0])
	})

	test('cleans up every exact liquidity or redemption principal when live inventory falls below it', () => {
		for (const definitionId of ['trading.pair.initialize-shares', 'trading.liquidity.add-shares'] as const) {
			const snapshot = openTradingSnapshot()
			const pair = snapshot.pairs[0]
			const shares = snapshot.wallet.shares[0]
			if (pair === undefined || shares === undefined) throw new Error('Direct inventory cleanup fixture is incomplete')
			if (definitionId === 'trading.pair.initialize-shares') {
				pair.status = 6
				pair.totalSupply = '0'
				pair.effectiveYesReserve = '0'
				pair.effectiveNoReserve = '0'
			}
			const original = requiredPlan(snapshot, definitionId)
			const shareAmount = requiredBigint(decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: requiredAction(original).data }).args[0], `${definitionId} share amount`)
			const confirmedApproval = confirmShareApproval(snapshot, original, pair.address)
			shares.yes = (shareAmount - 1n).toString()
			const cleanup = exactContinuation(snapshot, original, confirmedApproval)
			if (cleanup === undefined) throw new Error(`Missing ${definitionId} inventory cleanup`)
			expect(decodeFunctionData({ abi: erc1155Abi, data: requiredAction(cleanup).data }).args, definitionId).toEqual([pair.address, false])
		}

		const redeemSnapshot = openTradingSnapshot()
		const redeemShares = redeemSnapshot.wallet.shares[0]
		if (redeemShares === undefined) throw new Error('Redeem inventory cleanup fixture is incomplete')
		const redeem = requiredPlan(redeemSnapshot, 'trading.complete-set.redeem')
		const transferredAmounts = decodeFunctionData({ abi: erc1155Abi, data: requiredAction(redeem).data }).args[3]
		if (!Array.isArray(transferredAmounts)) throw new Error('Redeem transfer amounts are missing')
		const completeAmount = requiredBigint(transferredAmounts[0], 'redeem complete amount')
		redeemShares.invalid = (completeAmount - 1n).toString()
		expect(exactContinuation(redeemSnapshot, redeem, '')).toBeUndefined()

		const removeSnapshot = openTradingSnapshot()
		const pair = removeSnapshot.pairs[0]
		const lp = removeSnapshot.wallet.lpTokens[0]
		if (pair === undefined || lp === undefined) throw new Error('LP inventory cleanup fixture is incomplete')
		lp.allowanceToRouter = '0'
		const remove = requiredPlan(removeSnapshot, 'trading.liquidity.remove')
		const liquidity = requiredBigint(decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: requiredAction(remove).data }).args[0], 'remove liquidity')
		lp.balance = (liquidity - 1n).toString()
		pair.walletLiquidity = (liquidity - 1n).toString()
		expect(exactContinuation(removeSnapshot, remove, '')).toBeUndefined()
	})

	test('uses revoke-only cleanup after a terminal failure for approval-based pair operations', () => {
		const shareSnapshot = openTradingSnapshot()
		const pair = shareSnapshot.pairs[0]
		if (pair === undefined) throw new Error('Share cleanup fixture is incomplete')
		const add = requiredPlan(shareSnapshot, 'trading.liquidity.add-shares')
		const shareApproval = confirmShareApproval(shareSnapshot, add, pair.address)
		const shareCleanup = exactContinuation(shareSnapshot, add, shareApproval, 'cleanup-only')
		if (shareCleanup === undefined) throw new Error('Missing share cleanup')
		expect(decodeFunctionData({ abi: erc1155Abi, data: requiredAction(shareCleanup).data }).args).toEqual([pair.address, false])
		expect(shareCleanup.continuationDisposition).toBe('cleanup-only')
	})

	test('uses distinct reapproval steps when a confirmed approval was externally revoked', () => {
		const shareSnapshot = openTradingSnapshot()
		const pair = shareSnapshot.pairs[0]
		const shares = shareSnapshot.wallet.shares[0]
		if (pair === undefined || shares === undefined) throw new Error('Share reapproval fixture is incomplete')
		shares.no = '0'
		const swap = requiredPlan(shareSnapshot, 'trading.swap.exact-input')
		const confirmedShareApproval = confirmShareApproval(shareSnapshot, swap, pair.address)
		shares.isApprovedForAll[pair.address] = false
		const shareContinuation = exactContinuation(shareSnapshot, swap, confirmedShareApproval)
		if (shareContinuation === undefined) throw new Error('Missing share reapproval continuation')
		const shareReapproval = shareContinuation.steps.find(step => step.id.startsWith('reapprove-shares-'))
		if (shareReapproval === undefined) throw new Error('Missing distinct share reapproval')
		expect(shareReapproval.id).not.toBe(confirmedShareApproval)
		expect(decodeFunctionData({ abi: erc1155Abi, data: shareReapproval.data }).args).toEqual([pair.address, true])
		const workflow = createDurableWorkflow(swap)
		markWorkflowStepConfirmed(workflow, confirmedShareApproval, hash(301))
		refreshWorkflowContinuation(workflow, shareContinuation)
		expect(workflow.steps.find(step => step.id === confirmedShareApproval)?.status).toBe('confirmed')
		expect(workflow.steps.find(step => step.id === shareReapproval.id)?.status).toBe('planned')
		const repeated = exactContinuation(shareSnapshot, durableWorkflowPlan(workflow), confirmedShareApproval)
		expect(repeated?.steps.find(step => step.id.startsWith('reapprove-shares-'))?.id).toBe(shareReapproval.id)
	})

	test('invalidates receive-based work when the canonical router changes but keeps direct LP removal independent', () => {
		const shareSnapshot = openTradingSnapshot()
		const redeem = requiredPlan(shareSnapshot, 'trading.complete-set.redeem')
		shareSnapshot.deployments.tradingRouter = address(901)
		expect(exactContinuation(shareSnapshot, redeem, '')).toBeUndefined()

		const lpSnapshot = openTradingSnapshot()
		const remove = requiredPlan(lpSnapshot, 'trading.liquidity.remove')
		lpSnapshot.deployments.tradingRouter = address(902)
		expect(exactContinuation(lpSnapshot, remove, '')).toBeDefined()
	})
})
