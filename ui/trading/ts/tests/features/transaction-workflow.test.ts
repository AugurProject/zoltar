import { describe, expect, test } from 'bun:test'
import type { Address, Hash } from '@zoltar/shared/ethereum'
import { idleTransactionWorkflow, transactionPhase, transactionWorkflowReducer, type TransactionContext } from '../../features/live/transactionWorkflow.js'

const context: TransactionContext = {
	account: '0x0000000000000000000000000000000000000001' as Address,
	chainId: 31_337,
	market: '0x0000000000000000000000000000000000000002' as Address,
	requestRevision: 4,
}
const originalHash = `0x${'11'.repeat(32)}` as Hash
const replacementHash = `0x${'22'.repeat(32)}` as Hash

describe('transaction workflow state machine', () => {
	test('represents simulation, broadcast, replacement, and confirmation without losing hash ancestry', () => {
		let state = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'simulation-started', context })
		state = transactionWorkflowReducer(state, { type: 'simulation-succeeded', context })
		expect(transactionPhase(state)).toBe('ready')
		state = transactionWorkflowReducer(state, { type: 'operation-preparing', context, operation: 'trade' })
		state = transactionWorkflowReducer(state, { type: 'signature-requested', context, operation: 'trade' })
		state = transactionWorkflowReducer(state, { type: 'broadcast', context, operation: 'trade', transactionHash: originalHash })
		state = transactionWorkflowReducer(state, { type: 'replaced', context, replacementHash })
		expect(state).toEqual({ kind: 'pending', context, operation: 'trade', originalHash, transactionHash: replacementHash, replacementHashes: [replacementHash] })
		state = transactionWorkflowReducer(state, { type: 'confirmed', context })
		expect(state).toEqual({ kind: 'confirmed', context, operation: 'trade', transactionHash: replacementHash })
	})

	test('keeps approval and trade receipts in distinct operation states', () => {
		let state = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'operation-preparing', context, operation: 'share-approval' })
		state = transactionWorkflowReducer(state, { type: 'signature-requested', context, operation: 'share-approval' })
		state = transactionWorkflowReducer(state, { type: 'broadcast', context, operation: 'share-approval', transactionHash: originalHash })
		expect(transactionPhase(state)).toBe('approval-pending')
		expect(() => transactionWorkflowReducer(state, { type: 'broadcast', context, operation: 'trade', transactionHash: replacementHash })).toThrow()
	})

	test('rejects results from an old account, chain, market, or revision', () => {
		const simulating = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'simulation-started', context })
		for (const stale of [
			{ ...context, account: '0x0000000000000000000000000000000000000003' as Address },
			{ ...context, chainId: 1 },
			{ ...context, market: '0x0000000000000000000000000000000000000004' as Address },
			{ ...context, requestRevision: 5 },
		]) {
			expect(() => transactionWorkflowReducer(simulating, { type: 'simulation-succeeded', context: stale })).toThrow('Stale transaction workflow event')
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

	test('retains a wallet invalidation notice and transaction hash when a known receipt arrives', () => {
		let state = transactionWorkflowReducer(idleTransactionWorkflow, { type: 'operation-preparing', context, operation: 'share-approval' })
		state = transactionWorkflowReducer(state, { type: 'signature-requested', context, operation: 'share-approval' })
		state = transactionWorkflowReducer(state, { type: 'broadcast', context, operation: 'share-approval', transactionHash: originalHash })
		state = transactionWorkflowReducer(state, { type: 'context-invalidated', message: 'Wallet account changed' })
		state = transactionWorkflowReducer(state, { type: 'confirmed', context })
		expect(state).toEqual({ kind: 'confirmed', context, operation: 'share-approval', transactionHash: originalHash, notice: 'Wallet account changed' })
	})
})
