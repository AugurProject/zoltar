import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initialRuntimeState, loadDurableState, saveDurableState } from '#state/operator-state'
import { resolveFinalizedReceipt } from '#execution/receipt-transition'
import { validateReceiptExpectation } from '#execution/receipt-validation'
import { coordinator, queuedLiquidationReceipt, receiptIntent, stagedOperationReceipt } from './receipt-fixtures.ts'

for (const operation of [0, 1] as const) {
	for (const outcome of ['success', 'failure', 'queued', 'reverted'] as const) {
		test(`durably resolves ${operation === 0 ? 'liquidation' : 'withdrawal'} ${outcome}, including old signed intents and retries`, async () => {
			const directory = await mkdtemp(join(tmpdir(), 'receipt-transition-'))
			try {
				const path = join(directory, 'state.json')
				const { intent, receipt } = await receiptIntent(operation, outcome === 'queued')
				if (outcome === 'reverted') {
					receipt.status = 'reverted'
					receipt.logs = []
				} else if (outcome !== 'queued') receipt.logs.push(...stagedOperationReceipt(outcome === 'success', BigInt(operation)).logs)
				const state = initialRuntimeState(false, intent.sender, 1)
				state.pendingTransactions.push(intent)
				await saveDurableState(path, state)
				state.pendingTransactions = (await loadDurableState(path, 1)).pendingTransactions
				const transition = resolveFinalizedReceipt(path, state, intent, receipt)
				if (outcome === 'failure' || outcome === 'reverted') await expect(transition).rejects.toThrow(outcome === 'failure' ? 'liquidation too close' : 'reverted')
				else await transition
				await resolveFinalizedReceipt(path, state, intent, receipt)
				const loaded = await loadDurableState(path, 1)
				expect(loaded.pendingTransactions).toHaveLength(0)
				expect(loaded.pendingStagedOperations).toHaveLength(outcome === 'queued' ? 1 : 0)
				expect(loaded.activities).toHaveLength(1)
				expect(loaded.activities[0]?.status).toBe(({ queued: 'pending', success: 'confirmed', failure: 'failed', reverted: 'failed' } as const)[outcome])
				if (outcome === 'queued') expect(loaded.pendingStagedOperations[0]?.operation).toBe(operation)
			} finally {
				await rm(directory, { recursive: true, force: true })
			}
		})
	}
}

for (const outcome of ['success', 'failure', 'queued'] as const) {
	test(`retains ${outcome} tracking on write failure and retries without duplication`, async () => {
		const directory = await mkdtemp(join(tmpdir(), 'receipt-write-'))
		try {
			const { intent, receipt } = await receiptIntent(0, outcome === 'queued')
			if (outcome !== 'queued') receipt.logs.push(...stagedOperationReceipt(outcome === 'success').logs)
			const state = initialRuntimeState(false, intent.sender, 1)
			state.pendingTransactions.push(intent)
			const path = join(directory, 'state.json')
			await saveDurableState(path, state)
			const blocker = join(directory, 'not-a-directory')
			await writeFile(blocker, '')
			await expect(resolveFinalizedReceipt(join(blocker, 'state.json'), state, intent, receipt)).rejects.toThrow()
			expect(state.pendingTransactions).toHaveLength(1)
			expect(state.pendingStagedOperations).toHaveLength(0)
			expect(state.activities).toHaveLength(0)
			state.pendingTransactions = (await loadDurableState(path, 1)).pendingTransactions
			const retry = resolveFinalizedReceipt(path, state, intent, receipt)
			if (outcome === 'failure') await expect(retry).rejects.toThrow('liquidation too close')
			else await retry
			expect((await loadDurableState(path, 1)).pendingTransactions).toHaveLength(0)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
}

test('blocks missing, malformed, unrelated and conflicting evidence', async () => {
	const { intent, receipt } = await receiptIntent()
	receipt.logs.push(...stagedOperationReceipt(true).logs)
	const expectation = intent.receiptExpectation
	expect(validateReceiptExpectation(receipt, expectation, intent).type).toBe('terminal-success')
	for (const logs of [
		[],
		receipt.logs.slice(1),
		[...receipt.logs, ...receipt.logs.slice(0, 1)],
		[...queuedLiquidationReceipt(false).logs, ...stagedOperationReceipt(true).logs],
		[...receipt.logs.slice(0, 2), ...stagedOperationReceipt(true, 1n).logs],
		[...receipt.logs, ...stagedOperationReceipt(false).logs],
		[...receipt.logs.slice(0, 2), ...stagedOperationReceipt(true, 0n, 2n).logs],
		receipt.logs.map(log => ({ ...log, address: intent.sender })),
		receipt.logs.map(log => ({ ...log, data: '0x' as const })),
	]) {
		expect(() => validateReceiptExpectation({ ...receipt, logs }, expectation, intent)).toThrow()
	}
	for (const field of ['operator', 'target', 'receiver'] as const) {
		const expected = { type: 'pending-liquidation' as const, coordinator, operator: intent.sender, receiver: intent.sender, target: '0x0000000000000000000000000000000000000030' as const, amount: 10n, [field]: coordinator }
		expect(() => validateReceiptExpectation(receipt, expected, intent)).toThrow()
	}
	const pending = await receiptIntent(0, true)
	pending.receipt.logs.push(...stagedOperationReceipt(true).logs)
	expect(() => validateReceiptExpectation(pending.receipt, pending.intent.receiptExpectation, pending.intent)).toThrow('conflicting')
})

test('deduplicates matching staged tracking but retains intents on conflicting tracking', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'receipt-deduplicate-'))
	try {
		const { intent, receipt } = await receiptIntent(0, true)
		const state = initialRuntimeState(false, intent.sender, 1)
		state.pendingTransactions.push(intent)
		state.pendingStagedOperations.push({ coordinator, operationId: 1n, queuedBlock: receipt.blockNumber, target: intent.sender })
		await expect(resolveFinalizedReceipt(join(directory, 'state.json'), state, intent, receipt)).rejects.toThrow('Conflicting')
		expect(state.pendingTransactions).toHaveLength(1)
		state.pendingStagedOperations[0] = { coordinator, operationId: 1n, queuedBlock: receipt.blockNumber, target: '0x0000000000000000000000000000000000000030' }
		await resolveFinalizedReceipt(join(directory, 'state.json'), state, intent, receipt)
		expect(state.pendingStagedOperations).toHaveLength(1)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('persists new coordinator expectations and authenticates their outcome from signed calldata', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'receipt-expectation-'))
	try {
		const { intent, receipt } = await receiptIntent()
		intent.receiptExpectation = { type: 'coordinator-operation', coordinator, operation: 0 }
		receipt.logs.push(...stagedOperationReceipt(true).logs)
		const state = initialRuntimeState(false, intent.sender, 1)
		state.pendingTransactions.push(intent)
		const path = join(directory, 'state.json')
		await saveDurableState(path, state)
		const loaded = await loadDurableState(path, 1)
		const restored = loaded.pendingTransactions[0]
		if (restored === undefined) throw new Error('Missing persisted intent')
		expect(restored.receiptExpectation).toEqual(intent.receiptExpectation)
		expect(validateReceiptExpectation(receipt, restored.receiptExpectation, restored).type).toBe('terminal-success')
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
