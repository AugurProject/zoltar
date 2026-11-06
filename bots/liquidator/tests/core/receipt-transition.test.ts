import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initialRuntimeState, loadDurableState, saveDurableState } from '#state/operator-state'
import { resolveFinalizedReceipt } from '#execution/receipt-transition'
import { validateReceiptExpectation } from '#execution/receipt-validation'
import { portfolioReceiptIntent } from './portfolio-receipt-fixture.ts'

for (const status of ['success', 'reverted'] as const) {
	test(`durably resolves portfolio ${status} after restart and deduplicates retries`, async () => {
		const directory = await mkdtemp(join(tmpdir(), 'receipt-transition-'))
		try {
			const path = join(directory, 'state.json')
			const { intent, receipt } = await portfolioReceiptIntent()
			receipt.status = status
			const state = initialRuntimeState(false, intent.sender, 1)
			state.pendingTransactions.push(intent)
			await saveDurableState(path, state)
			state.pendingTransactions = (await loadDurableState(path, 1)).pendingTransactions
			const transition = resolveFinalizedReceipt(path, state, intent, receipt)
			if (status === 'reverted') await expect(transition).rejects.toThrow('reverted')
			else await transition
			await resolveFinalizedReceipt(path, state, intent, receipt)
			const loaded = await loadDurableState(path, 1)
			expect(loaded.pendingTransactions).toHaveLength(0)
			expect(loaded.activities).toHaveLength(1)
			expect(loaded.activities[0]?.status).toBe(status === 'success' ? 'confirmed' : 'failed')
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})

	test(`retains ${status} tracking on write failure and retries without duplication`, async () => {
		const directory = await mkdtemp(join(tmpdir(), 'receipt-write-'))
		try {
			const { intent, receipt } = await portfolioReceiptIntent()
			receipt.status = status
			const state = initialRuntimeState(false, intent.sender, 1)
			state.pendingTransactions.push(intent)
			const path = join(directory, 'state.json')
			await saveDurableState(path, state)
			const blocker = join(directory, 'not-a-directory')
			await writeFile(blocker, '')
			await expect(resolveFinalizedReceipt(join(blocker, 'state.json'), state, intent, receipt)).rejects.toThrow()
			expect(state.pendingTransactions).toHaveLength(1)
			expect(state.activities).toHaveLength(0)
			state.pendingTransactions = (await loadDurableState(path, 1)).pendingTransactions
			const retry = resolveFinalizedReceipt(path, state, intent, receipt)
			if (status === 'reverted') await expect(retry).rejects.toThrow('reverted')
			else await retry
			expect((await loadDurableState(path, 1)).pendingTransactions).toHaveLength(0)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
}

test('rejects receipt hash, sender, or target mismatches before consuming an intent', async () => {
	const { intent, receipt } = await portfolioReceiptIntent()
	expect(validateReceiptExpectation(receipt, intent.receiptExpectation, intent).type).toBe('terminal-success')
	for (const changed of [
		{ ...receipt, transactionHash: `0x${'22'.repeat(32)}` as const },
		{ ...receipt, from: '0x0000000000000000000000000000000000000030' as const },
		{ ...receipt, to: intent.sender },
		{ ...receipt, to: undefined },
		{ ...receipt, to: null },
	])
		expect(() => validateReceiptExpectation(changed, intent.receiptExpectation, intent)).toThrow('does not match signed intent')
})
