import { describe, expect, test } from 'bun:test'
import { getAddress, privateKeyToAccount, type Hex } from '../helpers/ethereum.ts'
import { parseTransactionReconciliation, validateFinalizedReplacement, validateReconciliationIntentChain, verifyFinalizedReplacement } from '../../src/core/transaction-reconciliation.ts'

const intentHash = `0x${'11'.repeat(32)}` as Hex
const replacementHash = `0x${'22'.repeat(32)}` as Hex
const sender = getAddress('0x0000000000000000000000000000000000000010')

describe('manual transaction reconciliation', () => {
	test('parses exact transaction hashes and validates a same-sender same-nonce replacement', () => {
		expect(parseTransactionReconciliation({ intentHash, replacementHash })).toEqual({ intentHash, replacementHash })
		expect(() => validateFinalizedReplacement({ hash: intentHash, nonce: 7n, sender }, replacementHash, { blockHash: `0x${'33'.repeat(32)}`, blockNumber: 100n, from: sender, hash: replacementHash, nonce: 7n, status: 'success' })).not.toThrow()
	})

	test('rejects the original hash, another sender, and another nonce', () => {
		const evidence = { blockHash: `0x${'33'.repeat(32)}` as Hex, blockNumber: 100n, from: sender, hash: replacementHash, nonce: 7n, status: 'reverted' as const }
		expect(() => validateFinalizedReplacement({ hash: intentHash, nonce: 7n, sender }, replacementHash, { ...evidence, hash: intentHash })).toThrow('automatic receipt recovery')
		expect(() => validateFinalizedReplacement({ hash: intentHash, nonce: 7n, sender }, `0x${'44'.repeat(32)}`, evidence)).toThrow('another transaction')
		expect(() => validateFinalizedReplacement({ hash: intentHash, nonce: 7n, sender }, replacementHash, { ...evidence, from: getAddress('0x0000000000000000000000000000000000000020') })).toThrow('another account')
		expect(() => validateFinalizedReplacement({ hash: intentHash, nonce: 7n, sender }, replacementHash, { ...evidence, nonce: 8n })).toThrow('did not consume')
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
