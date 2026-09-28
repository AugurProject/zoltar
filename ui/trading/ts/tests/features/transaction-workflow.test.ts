import { describe, expect, test } from 'bun:test'
import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import {
	marketTransactionWorkflow,
	marketTransactionWorkflowsReducer,
	transactionMarketKey,
	transactionPhase,
	transactionWorkflowError,
	transactionWorkflowHash,
	transactionWorkflowReceiptWarning,
	type MarketTransactionWorkflows,
	type TransactionContext,
	type TransactionWorkflowEvent,
	type TransactionWorkflowState,
} from '../../features/live/transactionWorkflow.js'

// One market's slot of the per-market reducer is the single-transaction state machine.
const slot = 'market'
const idleTransactionWorkflow = marketTransactionWorkflow({}, slot)
const transactionWorkflowReducer = (state: TransactionWorkflowState, event: TransactionWorkflowEvent) => marketTransactionWorkflow(marketTransactionWorkflowsReducer({ [slot]: state }, { type: 'market', market: slot, event }), slot)

const context: TransactionContext = {
	account: '0x0000000000000000000000000000000000000001' as Address,
	chainId: 31_337,
	market: '0x0000000000000000000000000000000000000002' as Address,
	requestRevision: 4,
}
const originalHash = `0x${'11'.repeat(32)}` as Hash
const replacementHash = `0x${'22'.repeat(32)}` as Hash

describe('transaction workflow state machine', () => {
	test('represents preparation, broadcast, replacement, and confirmation without losing hash ancestry', () => {
		let state = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'operation-preparing', context, operation: 'trade' })
		expect(transactionPhase(state)).toBe('preparing')
		state = transactionWorkflowReducer(state, { type: 'signature-requested', context, operation: 'trade' })
		state = transactionWorkflowReducer(state, { type: 'broadcast', context, operation: 'trade', transactionHash: originalHash })
		state = transactionWorkflowReducer(state, { type: 'replaced', context, replacementHash })
		expect(state).toEqual({ kind: 'pending', context, operation: 'trade', originalHash, transactionHash: replacementHash, replacementHashes: [replacementHash] })
		state = transactionWorkflowReducer(state, { type: 'confirmed', context })
		expect(state).toEqual({ kind: 'confirmed', context, operation: 'trade', transactionHash: replacementHash })
	})

	test('keeps transaction receipts bound to their originating operation', () => {
		let state = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'operation-preparing', context, operation: 'settlement' })
		state = transactionWorkflowReducer(state, { type: 'signature-requested', context, operation: 'settlement' })
		state = transactionWorkflowReducer(state, { type: 'broadcast', context, operation: 'settlement', transactionHash: originalHash })
		expect(transactionPhase(state)).toBe('pending')
		expect(() => transactionWorkflowReducer(state, { type: 'broadcast', context, operation: 'trade', transactionHash: replacementHash })).toThrow()
	})

	test.each([
		['settlement', 'pending', 'confirmed'],
		['liquidity', 'pending', 'confirmed'],
	] as const)('models the %s controller with one coherent transaction state', (operation, pendingPhase, confirmedPhase) => {
		let state = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'operation-preparing', context, operation })
		state = transactionWorkflowReducer(state, { type: 'signature-requested', context, operation })
		state = transactionWorkflowReducer(state, { type: 'broadcast', context, operation, transactionHash: originalHash })
		expect(transactionPhase(state)).toBe(pendingPhase)
		state = transactionWorkflowReducer(state, { type: 'replaced', context, replacementHash })
		expect(state).toMatchObject({ kind: 'pending', operation, originalHash, transactionHash: replacementHash, replacementHashes: [replacementHash] })
		state = transactionWorkflowReducer(state, { type: 'confirmed', context })
		expect(transactionPhase(state)).toBe(confirmedPhase)
	})

	test('rejects results from an old account, chain, market, or revision', () => {
		const preparing = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'operation-preparing', context, operation: 'trade' })
		for (const stale of [
			{ ...context, account: '0x0000000000000000000000000000000000000003' as Address },
			{ ...context, chainId: 1 },
			{ ...context, market: '0x0000000000000000000000000000000000000004' as Address },
			{ ...context, requestRevision: 5 },
		]) {
			expect(() => transactionWorkflowReducer(preparing, { type: 'signature-requested', context: stale, operation: 'trade' })).toThrow('Stale transaction workflow event')
		}
	})

	test('distinguishes reverted, uncertain, rejected-signature, and unmounted reset outcomes', () => {
		const preparing = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'operation-preparing', context, operation: 'trade' })
		const rejected = transactionWorkflowReducer(preparing, { type: 'failed', context, operation: 'trade', message: 'Signature rejected' })
		expect(rejected).toEqual({ kind: 'failed', context, operation: 'trade', message: 'Signature rejected' })

		const awaiting = transactionWorkflowReducer(preparing, { type: 'signature-requested', context, operation: 'trade' })
		const pending = transactionWorkflowReducer(awaiting, { type: 'broadcast', context, operation: 'trade', transactionHash: originalHash })
		expect(transactionWorkflowReducer(pending, { type: 'reverted', context }).kind).toBe('reverted')
		expect(transactionWorkflowReducer(pending, { type: 'uncertain', context, reason: 'Receipt unavailable' })).toEqual({ kind: 'uncertain', context, operation: 'trade', transactionHash: originalHash, reason: 'Receipt unavailable' })
		expect(transactionWorkflowReducer(pending, { type: 'reset' })).toEqual(idleTransactionWorkflow)
	})

	test('rejects illegal receipt and replacement transitions', () => {
		expect(() => transactionWorkflowReducer(idleTransactionWorkflow, { type: 'confirmed', context })).toThrow()
		expect(() => transactionWorkflowReducer(idleTransactionWorkflow, { type: 'replaced', context, replacementHash })).toThrow()
	})

	test('rejects cross-controller failures and protects uncertain broadcasts from input changes', () => {
		let state = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'operation-preparing', context, operation: 'liquidity' })
		expect(() => transactionWorkflowReducer(state, { type: 'failed', context, operation: 'settlement', message: 'wrong workflow' })).toThrow('Failure operation does not match')
		state = transactionWorkflowReducer(state, { type: 'signature-requested', context, operation: 'liquidity' })
		state = transactionWorkflowReducer(state, { type: 'broadcast', context, operation: 'liquidity', transactionHash: originalHash })
		state = transactionWorkflowReducer(state, { type: 'uncertain', context, reason: 'Receipt unavailable' })
		expect(() => transactionWorkflowReducer(state, { type: 'inputs-invalidated' })).toThrow('Inputs cannot invalidate an active or uncertain transaction')
		expect(() => transactionWorkflowReducer(state, { type: 'operation-preparing', context: { ...context, requestRevision: 5 }, operation: 'settlement' })).toThrow('An operation cannot replace an active or uncertain transaction')
	})

	test('clears failures on input changes while preserving only explicitly retained confirmations', () => {
		const failed = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'failed', message: 'Price moved' })
		expect(transactionWorkflowReducer(failed, { type: 'inputs-invalidated' })).toEqual(idleTransactionWorkflow)

		let confirmed = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'operation-preparing', context, operation: 'settlement' })
		confirmed = transactionWorkflowReducer(confirmed, { type: 'signature-requested', context, operation: 'settlement' })
		confirmed = transactionWorkflowReducer(confirmed, { type: 'broadcast', context, operation: 'settlement', transactionHash: originalHash })
		confirmed = transactionWorkflowReducer(confirmed, { type: 'confirmed', context })
		expect(transactionWorkflowReducer(confirmed, { type: 'inputs-invalidated', preserveConfirmed: true })).toEqual(confirmed)
		expect(transactionWorkflowReducer(confirmed, { type: 'inputs-invalidated' })).toEqual(idleTransactionWorkflow)
	})

	test('does not let other work replace a pending broadcast', () => {
		let pending = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'operation-preparing', context, operation: 'trade' })
		pending = transactionWorkflowReducer(pending, { type: 'signature-requested', context, operation: 'trade' })
		pending = transactionWorkflowReducer(pending, { type: 'broadcast', context, operation: 'trade', transactionHash: originalHash })
		expect(() => transactionWorkflowReducer(pending, { type: 'operation-preparing', context: { ...context, requestRevision: 5 }, operation: 'settlement' })).toThrow('An operation cannot replace an active or uncertain transaction')
	})

	test('retains a wallet invalidation notice and transaction hash when a known receipt arrives', () => {
		let state = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'operation-preparing', context, operation: 'settlement' })
		state = transactionWorkflowReducer(state, { type: 'signature-requested', context, operation: 'settlement' })
		state = transactionWorkflowReducer(state, { type: 'broadcast', context, operation: 'settlement', transactionHash: originalHash })
		state = transactionWorkflowReducer(state, { type: 'context-invalidated', message: 'Wallet account changed' })
		state = transactionWorkflowReducer(state, { type: 'confirmed', context })
		expect(state).toEqual({ kind: 'confirmed', context, operation: 'settlement', transactionHash: originalHash, notice: 'Wallet account changed' })
	})

	test('surfaces the newest wallet invalidation notice ahead of an earlier failure across every workflow', () => {
		// Trade, liquidity, and settlement workflows share these selectors, so a context change reported after a
		// failure always wins: it is the newer fact and the reason the failed request can no longer be retried as-is.
		const failed = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'failed', context, operation: 'trade', message: 'Router simulation failed' })
		expect(transactionWorkflowError(failed, 'Trade transaction reverted')).toBe('Router simulation failed')
		const invalidated = transactionWorkflowReducer(failed, { type: 'context-invalidated', message: 'Wallet account changed' })
		expect(transactionWorkflowError(invalidated, 'Trade transaction reverted')).toBe('Wallet account changed')
		expect(transactionWorkflowHash(invalidated)).toBeUndefined()
		expect(transactionWorkflowReceiptWarning(invalidated)).toBeUndefined()

		let reverted = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'operation-preparing', context, operation: 'trade' })
		reverted = transactionWorkflowReducer(reverted, { type: 'signature-requested', context, operation: 'trade' })
		reverted = transactionWorkflowReducer(reverted, { type: 'broadcast', context, operation: 'trade', transactionHash: originalHash })
		reverted = transactionWorkflowReducer(reverted, { type: 'reverted', context })
		expect(transactionWorkflowError(reverted, 'Trade transaction reverted')).toBe('Trade transaction reverted')
		expect(transactionWorkflowHash(reverted)).toBe(originalHash)
	})
})

describe('per-market transaction workflows', () => {
	const firstMarket = transactionMarketKey(context.market)
	const secondContext: TransactionContext = { ...context, market: '0x00000000000000000000000000000000000000AB' as Address, requestRevision: 5 }
	const secondMarket = transactionMarketKey(secondContext.market)
	const pendingOn = (workflows: MarketTransactionWorkflows, market: string, marketContext: TransactionContext, transactionHash: Hash) => {
		let next = marketTransactionWorkflowsReducer(workflows, { type: 'market', market, event: { type: 'operation-preparing', context: marketContext, operation: 'trade' } })
		next = marketTransactionWorkflowsReducer(next, { type: 'market', market, event: { type: 'signature-requested', context: marketContext, operation: 'trade' } })
		return marketTransactionWorkflowsReducer(next, { type: 'market', market, event: { type: 'broadcast', context: marketContext, operation: 'trade', transactionHash } })
	}

	test('runs one transaction per market, each settling on its own', () => {
		expect(secondMarket).toBe('0x00000000000000000000000000000000000000ab')
		expect(transactionMarketKey(undefined)).toBe('')
		const both = pendingOn(pendingOn({}, firstMarket, context, originalHash), secondMarket, secondContext, replacementHash)
		expect(transactionPhase(marketTransactionWorkflow(both, firstMarket))).toBe('pending')
		expect(transactionWorkflowHash(marketTransactionWorkflow(both, secondMarket))).toBe(replacementHash)
		const firstConfirmed = marketTransactionWorkflowsReducer(both, { type: 'market', market: firstMarket, event: { type: 'confirmed', context } })
		expect(transactionPhase(marketTransactionWorkflow(firstConfirmed, firstMarket))).toBe('confirmed')
		expect(transactionPhase(marketTransactionWorkflow(firstConfirmed, secondMarket))).toBe('pending')
		const secondReverted = marketTransactionWorkflowsReducer(firstConfirmed, { type: 'market', market: secondMarket, event: { type: 'reverted', context: secondContext } })
		expect(marketTransactionWorkflow(secondReverted, secondMarket).kind).toBe('reverted')
		expect(marketTransactionWorkflow(secondReverted, firstMarket).kind).toBe('confirmed')
		// An event carrying one market's context cannot land on another market's slot.
		expect(() => marketTransactionWorkflowsReducer(both, { type: 'market', market: secondMarket, event: { type: 'confirmed', context } })).toThrow('Stale transaction workflow event')
		expect(marketTransactionWorkflow({}, secondMarket)).toBe(idleTransactionWorkflow)
	})

	test('resets only unlocked markets and keeps running transactions through a wallet change', () => {
		const firstFailed = marketTransactionWorkflowsReducer({}, { type: 'market', market: firstMarket, event: { type: 'failed', context, operation: 'trade', message: 'Price moved' } })
		const workflows = pendingOn(firstFailed, secondMarket, secondContext, replacementHash)
		const reset = marketTransactionWorkflowsReducer(workflows, { type: 'reset-unlocked', locked: [secondMarket] })
		expect(marketTransactionWorkflow(reset, firstMarket)).toBe(idleTransactionWorkflow)
		expect(transactionPhase(marketTransactionWorkflow(reset, secondMarket))).toBe('pending')
		const invalidated = marketTransactionWorkflowsReducer(reset, { type: 'wallet-context-invalidated', message: 'Wallet account changed', locked: [secondMarket], current: firstMarket })
		expect(transactionWorkflowError(marketTransactionWorkflow(invalidated, firstMarket), 'reverted')).toBe('Wallet account changed')
		expect(transactionPhase(marketTransactionWorkflow(invalidated, secondMarket))).toBe('pending')
		expect(marketTransactionWorkflow(invalidated, secondMarket).notice).toBe('Wallet account changed')
		// The market on screen keeps its running transaction too; it only gains the notice.
		const onPendingMarket = marketTransactionWorkflowsReducer(reset, { type: 'wallet-context-invalidated', message: 'Wallet network changed', locked: [secondMarket], current: secondMarket })
		expect(transactionWorkflowHash(marketTransactionWorkflow(onPendingMarket, secondMarket))).toBe(replacementHash)
		expect(marketTransactionWorkflow(onPendingMarket, firstMarket)).toBe(idleTransactionWorkflow)
	})
})
