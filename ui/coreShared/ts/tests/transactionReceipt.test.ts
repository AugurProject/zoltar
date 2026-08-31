import { describe, expect, mock, test } from 'bun:test'
import type { Hash, ReplacementReason } from '@zoltar/shared/ethereum'
import { waitForSubmittedTransactionReceipt, type SubmittedTransactionClient } from '../lib/transactionReceipt.js'

const originalHash = `0x${'1'.repeat(64)}` as Hash
const replacementHash = `0x${'2'.repeat(64)}` as Hash

function replacementClient(reason: ReplacementReason, onTransactionSubmitted = mock(() => undefined)): SubmittedTransactionClient<{ status: 'success' }> {
	return {
		onTransactionSubmitted,
		waitForTransactionReceipt: async parameters => {
			parameters.onReplaced?.({
				reason,
				replacedTransaction: { hash: originalHash } as never,
				transaction: { hash: replacementHash } as never,
				transactionReceipt: { status: 'success' } as never,
			})
			return { status: 'success' }
		},
	}
}

describe('submitted transaction receipts', () => {
	test('returns and reports the replacement hash for a repriced transaction', async () => {
		const onTransactionSubmitted = mock(() => undefined)
		const onTransactionReplaced = mock(() => undefined)
		const onKnownReceipt = mock(() => undefined)

		const result = await waitForSubmittedTransactionReceipt(replacementClient('repriced', onTransactionSubmitted), originalHash, { onKnownReceipt, onTransactionReplaced })

		expect(result.hash).toBe(replacementHash)
		expect(onTransactionSubmitted).toHaveBeenCalledWith(replacementHash)
		expect(onTransactionReplaced).toHaveBeenCalledWith(replacementHash, 'repriced')
		expect(onKnownReceipt).toHaveBeenCalledTimes(1)
	})

	test('marks a cancelled replacement receipt as known before rejecting it', async () => {
		const onTransactionReplaced = mock(() => undefined)
		const onKnownReceipt = mock(() => undefined)

		await expect(waitForSubmittedTransactionReceipt(replacementClient('cancelled'), originalHash, { onKnownReceipt, onTransactionReplaced })).rejects.toThrow('Transaction was cancelled in the wallet before confirmation.')

		expect(onTransactionReplaced).toHaveBeenCalledWith(replacementHash, 'cancelled')
		expect(onKnownReceipt).toHaveBeenCalledTimes(1)
	})

	test('marks a changed-call replacement receipt as known before rejecting it', async () => {
		const onTransactionReplaced = mock(() => undefined)
		const onKnownReceipt = mock(() => undefined)

		await expect(waitForSubmittedTransactionReceipt(replacementClient('replaced'), originalHash, { onKnownReceipt, onTransactionReplaced })).rejects.toThrow('Transaction was replaced in the wallet before confirmation.')

		expect(onTransactionReplaced).toHaveBeenCalledWith(replacementHash, 'replaced')
		expect(onKnownReceipt).toHaveBeenCalledTimes(1)
	})
})
