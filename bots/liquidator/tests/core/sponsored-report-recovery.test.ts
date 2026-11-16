import { expect, test } from 'bun:test'
import { portfolioReceiptIntent } from './portfolio-receipt-fixture.ts'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWalletClient, createRpcEndpointPool, privateKeyToAccount, toHex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { initialRuntimeState, loadDurableState } from '#state/operator-state'
import { reconcileSponsoredReports } from '#execution/sponsored-report-recovery'
import { portfolioObservation, portfolioSettings } from '../support/portfolio-observation.ts'
import { serveScriptedRpc } from '../support/scripted-rpc.ts'

test('report scans bound each range, resume their persisted cursor, and retain state on write failure or replaced anchor', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'sponsored-scan-'))
	const ranges: unknown[] = []
	let replaced = false
	const hash = `0x${'11'.repeat(32)}` as const
	const { endpoint, server, settings } = serveScriptedRpc((method, params) => {
		if (method === 'eth_blockNumber') return toHex(5000n)
		if (method === 'eth_getBlockByNumber') return { number: Array.isArray(params) && params[0] !== 'latest' ? params[0] : toHex(5000n), hash: replaced ? `0x${'22'.repeat(32)}` : hash, timestamp: '0x1', transactions: [] }
		if (method === 'eth_getLogs') {
			ranges.push(params)
			return []
		}
		throw new Error(`Unexpected RPC method ${String(method)}`)
	})
	try {
		settings.runtime.stateFile = join(directory, 'state.json')
		const pool = createRpcEndpointPool([endpoint])
		const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
		const wallet = createWalletClient({
			account,
			chain: mainnet,
			transport: custom({
				request: async () => {
					throw new Error('Unexpected signing call')
				},
			}),
		})
		const state = initialRuntimeState(false, account.address, 1)
		const observation = portfolioObservation()
		state.sponsoredReports = [{ feed: observation.snapshot.priceFeed, sponsor: account.address, fundingKey: `${observation.snapshot.capitalLedger.toLowerCase()}:${account.address.toLowerCase()}`, reportId: 7n, createdBlock: 10n, nextBlock: 10n }]
		await reconcileSponsoredReports(wallet, settings, state, pool)
		expect(ranges).toEqual([[expect.objectContaining({ fromBlock: toHex(10n), toBlock: toHex(2057n) })]])
		expect(state.sponsoredReports[0]?.nextBlock).toBe(2058n)
		const durable = await loadDurableState(settings.runtime.stateFile, 1)
		state.sponsoredReports = durable.sponsoredReports
		const before = state.sponsoredReports
		const blocker = join(directory, 'blocker')
		await writeFile(blocker, '')
		settings.runtime.stateFile = join(blocker, 'state.json')
		await expect(reconcileSponsoredReports(wallet, settings, state, pool)).rejects.toThrow()
		expect(state.sponsoredReports).toEqual(before)
		settings.runtime.stateFile = join(directory, 'state.json')
		await reconcileSponsoredReports(wallet, settings, state, pool)
		expect(state.sponsoredReports?.[0]?.nextBlock).toBe(4106n)
		replaced = true
		await expect(reconcileSponsoredReports(wallet, settings, state, pool)).rejects.toThrow('scan anchor was replaced')
		expect(state.sponsoredReports?.[0]?.nextBlock).toBe(4106n)
		expect(state.activities).toHaveLength(0)
	} finally {
		await server.stop(true)
		await rm(directory, { recursive: true, force: true })
	}
})

test('pending settlement receipts own their report transition so event scans cannot duplicate their result', async () => {
	const { intent } = await portfolioReceiptIntent()
	const observation = portfolioObservation()
	intent.reportOperations = { feed: observation.snapshot.priceFeed, reportId: 7n }
	const state = initialRuntimeState(false, intent.sender, 1)
	state.pendingTransactions.push(intent)
	state.sponsoredReports = [{ feed: observation.snapshot.priceFeed, fundingKey: `${observation.snapshot.capitalLedger.toLowerCase()}:${intent.sender.toLowerCase()}`, sponsor: intent.sender, reportId: 7n, createdBlock: 1n, nextBlock: 1n }]
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	const wallet = createWalletClient({
		account,
		chain: mainnet,
		transport: custom({
			request: async () => {
				throw new Error('Unexpected RPC')
			},
		}),
	})
	const pool = createRpcEndpointPool(['https://read.example'])
	await reconcileSponsoredReports(wallet, portfolioSettings(), state, pool)
	expect(state.sponsoredReports).toHaveLength(1)
	expect(state.pendingTransactions).toHaveLength(1)
	expect(state.activities).toHaveLength(0)
})
