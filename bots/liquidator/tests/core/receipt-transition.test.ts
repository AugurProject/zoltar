import { expect, test } from 'bun:test'
import { sharedPoolPriceFeedAbi } from '@zoltar/bot-shared/contracts/abi'
import { encodeEventTopics } from '@zoltar/core-shared/evm/ethereum'
import { registerSponsoredReplacement } from '#execution/sponsored-report-receipt'
import { encodeAbiParameters, getAddress, parseTransaction, toHex } from '@zoltar/bot-shared/ethereum'
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
			intent.portfolioInstruction = { id: 'one-shot-bid', fingerprint: 'immutable-bid-terms' }
			const fundingKey = `${intent.sender.toLowerCase()}:${intent.sender.toLowerCase()}`
			intent.portfolioFunding = { key: fundingKey, operation: 'fund', amount: 12n, target: 3n }
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
			expect(loaded.completedPortfolioInstructions).toEqual({ 'one-shot-bid': 'immutable-bid-terms' })
			expect(loaded.portfolioFunding).toEqual(status === 'success' ? { [fundingKey]: { amount: 12n, target: 3n } } : {})
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

for (const results of [[true, true], [false, true], [false, false], []]) {
	test(`persists sponsored operation outcomes after restart: ${JSON.stringify(results)}`, async () => {
		const directory = await mkdtemp(join(tmpdir(), 'report-receipt-'))
		try {
			const path = join(directory, 'state.json')
			const { intent, receipt } = await portfolioReceiptIntent()
			const feed = getAddress('0x0000000000000000000000000000000000000040')
			intent.reportOperations = { feed, reportId: 7n }
			intent.label = 'Settle sponsored takeover report'
			const log = (success: boolean, operationIndex: bigint, reportId = 7n, sponsor = intent.sender, address = feed) => ({
				address,
				blockHash: receipt.blockHash,
				blockNumber: receipt.blockNumber,
				topics: encodeEventTopics({ abi: sharedPoolPriceFeedAbi, eventName: 'ReportOperationAttempted', args: { reportId, sponsor, operationIndex } }).filter(topic => topic !== null),
				data: encodeAbiParameters([{ type: 'bool' }], [success]),
			})
			receipt.logs = [...results.map((success, index) => log(success, BigInt(index))), log(true, 0n, 8n), log(true, 0n, 7n, feed), log(true, 0n, 7n, intent.sender, intent.sender)]
			const state = initialRuntimeState(false, intent.sender, 1)
			state.pendingTransactions.push(intent)
			await saveDurableState(path, state)
			state.pendingTransactions = (await loadDurableState(path, 1)).pendingTransactions
			const recovered = state.pendingTransactions[0]
			if (recovered === undefined) throw new Error('Missing recovered intent')
			await resolveFinalizedReceipt(path, state, recovered, receipt)
			await resolveFinalizedReceipt(path, state, recovered, receipt)
			const saved = await loadDurableState(path, 1)
			expect(saved.activities).toHaveLength(1)
			const activity = saved.activities[0]
			if (results.length === 0) expect(activity?.message).toContain('no operation outcomes reported')
			else {
				expect(activity?.message).toContain(`${results.filter(Boolean).length} succeeded, ${results.filter(result => !result).length} failed`)
				for (const [index, success] of results.entries()) expect(activity?.message).toContain(`${index + 1} ${success ? 'succeeded' : 'failed'}`)
			}
			expect(activity?.status).toBe(results.length === 0 || results.includes(false) ? 'failed' : 'confirmed')
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
}

test('consumed report funding and its tracking record resolve atomically across write failures and restart', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'report-funding-transition-'))
	try {
		const { intent, receipt } = await portfolioReceiptIntent()
		const feed = getAddress('0x0000000000000000000000000000000000000040')
		const fundingKey = `${feed.toLowerCase()}:${intent.sender.toLowerCase()}`
		intent.reportOperations = { feed, reportId: 7n }
		receipt.logs = [
			{ address: feed, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, topics: encodeEventTopics({ abi: sharedPoolPriceFeedAbi, eventName: 'PriceReported', args: { reportId: 7n } }).filter(topic => topic !== null), data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [1n, 1n]) },
			{
				address: feed,
				blockHash: receipt.blockHash,
				blockNumber: receipt.blockNumber,
				topics: encodeEventTopics({ abi: sharedPoolPriceFeedAbi, eventName: 'ReportOperationAttempted', args: { reportId: 7n, sponsor: intent.sender, operationIndex: 0n } }).filter(topic => topic !== null),
				data: encodeAbiParameters([{ type: 'bool' }], [true]),
			},
		]
		const state = initialRuntimeState(false, intent.sender, 1)
		state.pendingTransactions.push(intent)
		state.portfolioFunding = { [fundingKey]: { amount: 100n, target: 3n } }
		state.sponsoredReports = [{ feed, fundingKey, sponsor: intent.sender, reportId: 7n, createdBlock: 1n, nextBlock: 1n }]
		const path = join(directory, 'state.json')
		await saveDurableState(path, state)
		const blocker = join(directory, 'blocker')
		await writeFile(blocker, '')
		await expect(resolveFinalizedReceipt(join(blocker, 'state.json'), state, intent, receipt)).rejects.toThrow()
		expect(state.portfolioFunding[fundingKey]?.amount).toBe(100n)
		expect(state.sponsoredReports).toHaveLength(1)
		expect(state.pendingTransactions).toHaveLength(1)
		expect(state.activities).toHaveLength(0)
		const restarted = await loadDurableState(path, 1)
		state.sponsoredReports = restarted.sponsoredReports
		state.portfolioFunding = restarted.portfolioFunding
		state.pendingTransactions = restarted.pendingTransactions
		await resolveFinalizedReceipt(path, state, intent, receipt)
		await resolveFinalizedReceipt(path, state, intent, receipt)
		const saved = await loadDurableState(path, 1)
		expect(saved.sponsoredReports).toHaveLength(0)
		expect(saved.portfolioFunding).toEqual({})
		expect(saved.pendingTransactions).toHaveLength(0)
		expect(saved.activities).toHaveLength(1)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('equivalent fee replacements inherit report tracking; cancellations and changed economic calls do not', async () => {
	const { intent, receipt } = await portfolioReceiptIntent()
	const feed = getAddress('0x0000000000000000000000000000000000000040')
	const fundingKey = `${feed.toLowerCase()}:${intent.sender.toLowerCase()}`
	intent.reportSponsorship = { feed, fundingKey }
	receipt.logs = [{ address: feed, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, topics: encodeEventTopics({ abi: sharedPoolPriceFeedAbi, eventName: 'ReportFundingAssigned', args: { reportId: 7n, coordinator: feed, sponsor: intent.sender } }).filter(topic => topic !== null), data: '0x' }]
	const original = parseTransaction(intent.serializedTransaction)
	const sameCall = { to: original.to, input: original.data ?? '0x', value: original.value ?? 0n }
	for (const changed of [
		{ ...sameCall, to: intent.sender },
		{ ...sameCall, input: toHex('') },
		{ ...sameCall, value: sameCall.value + 1n },
	]) {
		const state = initialRuntimeState(false, intent.sender, 1)
		registerSponsoredReplacement(state, intent, receipt, changed)
		expect(state.sponsoredReports ?? []).toHaveLength(0)
	}
	const state = initialRuntimeState(false, intent.sender, 1)
	registerSponsoredReplacement(state, intent, { ...receipt, status: 'reverted' }, sameCall)
	expect(state.sponsoredReports ?? []).toHaveLength(0)
	registerSponsoredReplacement(state, intent, receipt, sameCall)
	expect(state.sponsoredReports).toEqual([{ feed, fundingKey, sponsor: intent.sender, reportId: 7n, createdBlock: receipt.blockNumber, nextBlock: receipt.blockNumber }])
})
