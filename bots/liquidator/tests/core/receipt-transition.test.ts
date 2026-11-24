import { expect, test } from 'bun:test'
import { securityPoolCapitalLedgerAbi, sharedPoolPriceFeedAbi } from '@zoltar/bot-shared/contracts/abi'
import { encodeEventTopics } from '@zoltar/core-shared/evm/ethereum'
import { encodeAbiParameters, getAddress, type Address, type TransactionReceipt } from '@zoltar/bot-shared/ethereum'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initialRuntimeState, loadDurableState, saveDurableState } from '#state/operator-state'
import { resolveFinalizedReceipt } from '#execution/receipt-transition'
import { validateReceiptExpectation } from '#execution/receipt-validation'
import { securityPoolReceiptIntent } from './security-pool-receipt-fixture.ts'
import { explainTakeoverReceiptExpiry } from '#execution/takeover-receipt-expiry'
import { securityPoolClient } from '../support/security-pool-client.ts'

test('takeover expiry requires consistent final receipt-block evidence (#1372)', async () => {
	const { intent, receipt } = await securityPoolReceiptIntent('takeOverWithBounds')
	receipt.status = 'reverted'
	receipt.blockNumber = 123n
	const newEpoch = securityPoolClient({ acceptedPriceEpoch: 3n })
	const unchanged = securityPoolClient({ acceptedPriceEpoch: 2n })
	receipt.blockHash = newEpoch.observation.snapshot.blockHash
	const updatedReaders = [{ client: newEpoch.client, endpoint: 'https://read.example' }]
	expect(await explainTakeoverReceiptExpiry(intent, receipt, updatedReaders, 1)).toBe('Accepted price epoch changed')
	expect(await explainTakeoverReceiptExpiry(intent, receipt, [{ client: unchanged.client, endpoint: 'https://read.example' }], 1)).toBeUndefined()
	await expect(explainTakeoverReceiptExpiry(intent, receipt, [...updatedReaders, { client: unchanged.client, endpoint: 'https://other.example' }], 2)).rejects.toThrow('RPC disagreement')
	await expect(explainTakeoverReceiptExpiry(intent, { ...receipt, blockHash: `0x${'fe'.repeat(32)}` }, updatedReaders, 1)).rejects.toThrow('receipt block changed')
	expect(await explainTakeoverReceiptExpiry(intent, { ...receipt, gasUsed: 1_000_000n }, updatedReaders, 1)).toBeUndefined()
})

test('price expiry alone cannot explain a reverted auction fill; an inactive universe can', async () => {
	const { intent, receipt } = await securityPoolReceiptIntent('takeOverWithBounds')
	receipt.status = 'reverted'
	receipt.blockNumber = 123n
	const fresh = securityPoolClient({ acceptedPriceEpoch: 2n })
	receipt.blockHash = fresh.observation.snapshot.blockHash
	const explain = async (overrides: Record<string, unknown>) => explainTakeoverReceiptExpiry(intent, receipt, [{ client: securityPoolClient({ acceptedPriceEpoch: 2n, ...overrides }).client, endpoint: 'https://read.example' }], 1)
	const timestamp = fresh.observation.snapshot.timestamp
	expect(await explain({})).toBeUndefined()
	expect(await explain({ priceValidUntil: timestamp + 1n })).toBeUndefined()
	expect(await explain({ priceValidUntil: timestamp })).toBeUndefined()
	expect(await explain({ priceValidUntil: timestamp - 1n })).toBeUndefined()
	expect(await explain({ frozen: true })).toBe('Capital universe inactive')
	expect(await explain({ importing: true })).toBe('Capital universe inactive')
	expect(await explain({ getForkTime: 1n })).toBe('Capital universe inactive')
})

test('a finalized takeover whose terms expired is recorded as failed and retires its intent (#1372)', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'expired-takeover-'))
	try {
		const path = join(directory, 'state.json')
		const { intent, receipt } = await securityPoolReceiptIntent('takeOverWithBounds')
		receipt.status = 'reverted'
		const state = initialRuntimeState(false, intent.sender, 1)
		state.pendingTransactions.push(intent)
		const result = resolveFinalizedReceipt(path, state, intent, receipt, async () => 'Accepted price epoch changed')
		await expect(result).rejects.toMatchObject({ name: 'FinalizedTakeoverExpired' })
		const persisted = await loadDurableState(path, 1)
		expect(persisted.pendingTransactions).toHaveLength(0)
		expect(persisted.activities[0]).toMatchObject({ hash: intent.hash, status: 'failed', details: 'Accepted price epoch changed' })
		expect(persisted.securityPoolFunding).toEqual({})
		expect(persisted.lastExpiredTakeoverBlock).toBe(receipt.blockNumber)
		const restarted = initialRuntimeState(false, intent.sender, 1)
		restarted.lastExpiredTakeoverBlock = persisted.lastExpiredTakeoverBlock
		restarted.pendingTransactions.push(intent)
		await expect(resolveFinalizedReceipt(path, restarted, intent, { ...receipt, blockNumber: receipt.blockNumber + 1n }, async () => 'Security pool demand changed')).rejects.toThrow('reverted')
		expect((await loadDurableState(path, 1)).lastExpiredTakeoverBlock).toBe(receipt.blockNumber)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

for (const status of ['success', 'reverted'] as const) {
	test(`durably resolves security pool ${status} after restart and deduplicates retries`, async () => {
		const directory = await mkdtemp(join(tmpdir(), 'receipt-transition-'))
		try {
			const path = join(directory, 'state.json')
			const { intent, receipt } = await securityPoolReceiptIntent()
			receipt.status = status
			intent.securityPoolInstruction = { id: 'one-shot-bid', fingerprint: 'immutable-bid-terms' }
			const fundingKey = `${intent.sender.toLowerCase()}:${intent.sender.toLowerCase()}`
			intent.securityPoolFunding = { key: fundingKey, operation: 'fund', amount: 12n, target: 3n }
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
			expect(loaded.completedSecurityPoolInstructions).toEqual({ 'one-shot-bid': 'immutable-bid-terms' })
			expect(loaded.securityPoolFunding).toEqual(status === 'success' ? { [fundingKey]: { amount: 12n, target: 3n } } : {})
			expect(loaded.activities).toHaveLength(1)
			expect(loaded.activities[0]?.status).toBe(status === 'success' ? 'confirmed' : 'failed')
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})

	test(`retains ${status} tracking on write failure and retries without duplication`, async () => {
		const directory = await mkdtemp(join(tmpdir(), 'receipt-write-'))
		try {
			const { intent, receipt } = await securityPoolReceiptIntent()
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
	const { intent, receipt } = await securityPoolReceiptIntent()
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
			const { intent, receipt } = await securityPoolReceiptIntent()
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

test('a settlement above the report base-fee ceiling is recorded as deferred', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'report-deferred-'))
	try {
		const path = join(directory, 'state.json')
		const { intent, receipt } = await securityPoolReceiptIntent()
		const feed = getAddress('0x0000000000000000000000000000000000000040')
		intent.reportOperations = { feed, reportId: 7n }
		intent.label = 'Settle sponsored takeover report'
		receipt.logs = [
			{
				address: feed,
				blockHash: receipt.blockHash,
				blockNumber: receipt.blockNumber,
				topics: encodeEventTopics({ abi: sharedPoolPriceFeedAbi, eventName: 'PriceReportDeferred', args: { reportId: 7n } }).filter(topic => topic !== null),
				data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [34n * 10n ** 9n, 33n * 10n ** 9n]),
			},
		]
		const state = initialRuntimeState(false, intent.sender, 1)
		state.pendingTransactions.push(intent)
		await saveDurableState(path, state)
		await resolveFinalizedReceipt(path, state, intent, receipt)
		const saved = await loadDurableState(path, 1)
		expect(saved.activities[0]?.status).toBe('info')
		expect(saved.activities[0]?.message).toContain('settled above the report base-fee ceiling')
		expect(saved.pendingTransactions).toHaveLength(0)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test.each(['Report stale', 'Report uneconomic'])('journals a finalized report rejection with no operations (%s)', async reason => {
	const directory = await mkdtemp(join(tmpdir(), 'report-rejection-'))
	try {
		const path = join(directory, 'state.json')
		const { intent, receipt } = await securityPoolReceiptIntent()
		const feed = getAddress('0x0000000000000000000000000000000000000040')
		intent.reportOperations = { feed, reportId: 7n }
		receipt.logs = [
			{
				address: feed,
				blockHash: receipt.blockHash,
				blockNumber: receipt.blockNumber,
				topics: encodeEventTopics({ abi: sharedPoolPriceFeedAbi, eventName: 'PriceReportRejected', args: { reportId: 7n } }).filter(topic => topic !== null),
				data: encodeAbiParameters([{ type: 'string' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [reason, 0n, 0n, 5n, 10n]),
			},
		]
		const state = initialRuntimeState(false, intent.sender, 1)
		state.pendingTransactions.push(intent)
		await resolveFinalizedReceipt(path, state, intent, receipt)
		const saved = await loadDurableState(path, 1)
		expect(saved.activities[0]?.status).toBe('confirmed')
		expect(saved.activities[0]?.message).toContain(reason)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

function takenOverLog(receipt: TransactionReceipt, ledger: Address, sourceId: bigint) {
	return {
		address: ledger,
		blockHash: receipt.blockHash,
		blockNumber: receipt.blockNumber,
		topics: encodeEventTopics({ abi: securityPoolCapitalLedgerAbi, eventName: 'CommitmentTakenOver', args: { sourceId, receiverId: 9n } }).filter(topic => topic !== null),
		data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [10n, 0n]),
	}
}

async function resolveConsumedTakeover(logs: (receipt: TransactionReceipt, ledger: Address) => TransactionReceipt['logs']) {
	const directory = await mkdtemp(join(tmpdir(), 'takeover-consume-'))
	try {
		const path = join(directory, 'state.json')
		const { intent, receipt } = await securityPoolReceiptIntent('takeOverWithBounds')
		const ledger = receipt.to
		if (ledger === null || ledger === undefined) throw new Error('Missing ledger')
		const fundingKey = `${ledger.toLowerCase()}:${intent.sender.toLowerCase()}`
		intent.securityPoolFunding = { key: fundingKey, operation: 'consume', amount: 0n }
		receipt.logs = logs(receipt, ledger)
		const state = initialRuntimeState(false, intent.sender, 1)
		state.securityPoolFunding = { [fundingKey]: { amount: 500n, target: 1n } }
		state.pendingTransactions.push(intent)
		await saveDurableState(path, state)
		await resolveFinalizedReceipt(path, state, intent, receipt)
		return { saved: await loadDurableState(path, 1), fundingKey }
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

test('#1473 a successful takeover that the in-call cure healed keeps its funding journal and is not booked as completed', async () => {
	for (const logs of [() => [], (receipt: TransactionReceipt, ledger: Address) => [takenOverLog(receipt, ledger, 2n)], (receipt: TransactionReceipt) => [takenOverLog(receipt, getAddress('0x0000000000000000000000000000000000000041'), 1n)]]) {
		const { saved, fundingKey } = await resolveConsumedTakeover(logs)
		expect(saved.securityPoolFunding).toEqual({ [fundingKey]: { amount: 500n, target: 1n } })
		expect(saved.pendingTransactions).toHaveLength(0)
		expect(saved.activities[0]).toMatchObject({ status: 'info', message: 'Take over security pool position 1: takeover cured target; no position acquired' })
	}
})

test('#1473 a successful takeover that acquired the target consumes its funding journal', async () => {
	const { saved } = await resolveConsumedTakeover((receipt, ledger) => [takenOverLog(receipt, ledger, 1n)])
	expect(saved.securityPoolFunding).toEqual({})
	expect(saved.activities[0]).toMatchObject({ status: 'confirmed', message: 'Take over security pool position 1: completed' })
})
