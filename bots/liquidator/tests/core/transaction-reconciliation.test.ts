import { describe, expect, test } from 'bun:test'
import { getAddress, parseTransaction, privateKeyToAccount, type Hex } from '@zoltar/bot-shared/ethereum'
import { parseTransactionReconciliation, validateReconciliationIntentChain, verifyFinalizedReplacement, type FinalizedReplacementEvidence } from '../../src/core/transaction-reconciliation.ts'
import { applyMatchingReplacementEffects } from '../../src/runtime/transaction-reconciliation-handler.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { securityPoolReceiptIntent } from './security-pool-receipt-fixture.ts'
import { receiptEvidence } from '@zoltar/bot-shared/execution/receipt-quorum'

const intentHash = `0x${'11'.repeat(32)}` as Hex
const replacementHash = `0x${'22'.repeat(32)}` as Hex
const sender = getAddress('0x0000000000000000000000000000000000000010')

test.each(['matching', 'different', 'reverted'] as const)('records instruction and funding effects only for a successful matching replacement (%s)', async kind => {
	const { intent, receipt } = await securityPoolReceiptIntent()
	intent.securityPoolInstruction = { id: 'queued-deposit', fingerprint: 'deposit-v1' }
	const key = `${receipt.to?.toLowerCase()}:${intent.sender.toLowerCase()}`
	intent.securityPoolFunding = { key, operation: 'fund', amount: 5n, target: 1n }
	const signed = parseTransaction(intent.serializedTransaction)
	const state = initialRuntimeState(true, intent.sender, 1)
	applyMatchingReplacementEffects(state, intent, {
		transaction: { to: signed.to ?? undefined, input: kind === 'different' ? '0x' : (signed.data ?? '0x'), value: signed.value ?? 0n },
		receipt: receiptEvidence({ ...receipt, status: kind === 'reverted' ? 'reverted' : 'success', transactionHash: replacementHash }),
	})
	expect(state.completedSecurityPoolInstructions?.['queued-deposit']).toBe(kind === 'matching' ? 'deposit-v1' : undefined)
	expect(state.securityPoolFunding?.[key]?.amount).toBe(kind === 'matching' ? 5n : undefined)
})

// Verifies a replacement whose receipt is already final and canonical, isolating the intent/replacement validation.
function verifyFinalReplacement(requestedHash: Hex, replacement: FinalizedReplacementEvidence) {
	return verifyFinalizedReplacement({ hash: intentHash, nonce: 7n, sender }, requestedHash, 12n, {
		canonicalBlockHash: async () => replacement.blockHash,
		currentHeads: async () => [replacement.blockNumber + 12n],
		replacement: async () => replacement,
	})
}

describe('manual transaction reconciliation', () => {
	test('parses exact transaction hashes and validates a same-sender same-nonce replacement', async () => {
		expect(parseTransactionReconciliation({ intentHash, replacementHash })).toEqual({ intentHash, replacementHash })
		const evidence = { blockHash: `0x${'33'.repeat(32)}` as Hex, blockNumber: 100n, from: sender, hash: replacementHash, nonce: 7n, status: 'success' as const }
		await expect(verifyFinalReplacement(replacementHash, evidence)).resolves.toEqual(evidence)
	})

	test('rejects the original hash, another sender, and another nonce', async () => {
		const evidence = { blockHash: `0x${'33'.repeat(32)}` as Hex, blockNumber: 100n, from: sender, hash: replacementHash, nonce: 7n, status: 'reverted' as const }
		await expect(verifyFinalReplacement(replacementHash, { ...evidence, hash: intentHash })).rejects.toThrow('automatic receipt recovery')
		await expect(verifyFinalReplacement(`0x${'44'.repeat(32)}`, evidence)).rejects.toThrow('another transaction')
		await expect(verifyFinalReplacement(replacementHash, { ...evidence, from: getAddress('0x0000000000000000000000000000000000000020') })).rejects.toThrow('another account')
		await expect(verifyFinalReplacement(replacementHash, { ...evidence, nonce: 8n })).rejects.toThrow('did not consume')
	})

	test('requires quorum evidence, canonical receipt ancestry, and finality before returning a replacement', async () => {
		const blockHash = `0x${'33'.repeat(32)}` as Hex
		const finalityHash = `0x${'44'.repeat(32)}` as Hex
		const evidence = { blockHash, blockNumber: 100n, from: sender, hash: replacementHash, nonce: 7n, status: 'success' as const }
		const intent = { hash: intentHash, nonce: 7n, sender }
		const readers = {
			canonicalBlockHash: async (blockNumber: bigint) => (blockNumber === 100n ? blockHash : finalityHash),
			currentHeads: async () => [112n, 113n],
			replacement: async () => evidence,
		}
		await expect(verifyFinalizedReplacement(intent, replacementHash, 12n, readers)).resolves.toEqual(evidence)
		await expect(verifyFinalizedReplacement(intent, replacementHash, 12n, { ...readers, replacement: async () => undefined })).rejects.toThrow('not confirmed by the RPC quorum')
		await expect(verifyFinalizedReplacement(intent, replacementHash, 12n, { ...readers, replacement: async () => Promise.reject(new Error('RPC quorum disagreed')) })).rejects.toThrow('RPC quorum disagreed')
		await expect(verifyFinalizedReplacement(intent, replacementHash, 12n, { ...readers, currentHeads: async () => [111n, 113n] })).rejects.toThrow('required canonical finality depth')
		await expect(verifyFinalizedReplacement(intent, replacementHash, 12n, { ...readers, canonicalBlockHash: async () => finalityHash })).rejects.toThrow('receipt is no longer canonical')
	})

	test('binds reconciliation to the chain recorded in the signed intent', async () => {
		const account = privateKeyToAccount(`0x${'15'.repeat(32)}`)
		if (account.signTransaction === undefined) throw new Error('Test account cannot sign')
		const serialized = await account.signTransaction({ chainId: 1, gas: 21_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: 1n, to: sender, value: 0n })
		expect(() => validateReconciliationIntentChain(serialized, 1)).not.toThrow()
		expect(() => validateReconciliationIntentChain(serialized, 2)).toThrow('signed for a different chain')
	})
})
