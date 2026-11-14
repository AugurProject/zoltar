import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeEventTopics } from '@zoltar/core-shared/evm/ethereum'
import { chainFor } from '../../src/monitoring/operator-chain.ts'
import { createRpcEndpointPool, parseTransaction } from '@zoltar/bot-shared/ethereum'
import { sharedPoolPriceFeedAbi } from '@zoltar/bot-shared/contracts/abi'
import { createConfigurationMutationGate } from '#core/configuration-gate'
import { reconcileTransaction } from '../../src/runtime/transaction-reconciliation-handler.ts'
import { initialRuntimeState, loadDurableState } from '#state/operator-state'
import { portfolioReceiptIntent } from './portfolio-receipt-fixture.ts'
import { serveScriptedRpc } from '../support/scripted-rpc.ts'

test('manual fee replacement registers the created report atomically with removing the original intent', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'sponsored-replacement-'))
	const { intent } = await portfolioReceiptIntent()
	const original = parseTransaction(intent.serializedTransaction)
	if (original.to === undefined) throw new Error('Test transaction has no destination')
	const feed = original.to
	const fundingKey = `${feed.toLowerCase()}:${intent.sender.toLowerCase()}`
	intent.reportSponsorship = { feed, fundingKey }
	const replacementHash = `0x${'33'.repeat(32)}` as const
	const blockHash = `0x${'11'.repeat(32)}` as const
	const topics = encodeEventTopics({ abi: sharedPoolPriceFeedAbi, eventName: 'ReportFundingAssigned', args: { reportId: 7n, sponsor: intent.sender, coordinator: feed } })
	const { endpoint, server, settings } = serveScriptedRpc((method, params) => {
		if (method === 'eth_blockNumber') return '0x70'
		if (method === 'eth_getBlockByNumber') {
			const number = Array.isArray(params) && params[0] !== 'latest' ? params[0] : '0x70'
			return { number, hash: number === '0x64' ? blockHash : `0x${'22'.repeat(32)}`, timestamp: '0x1', transactions: [] }
		}
		if (method === 'eth_getTransactionByHash') return { blockHash, blockNumber: '0x64', hash: replacementHash, from: intent.sender, to: feed, input: original.data, nonce: '0x0', gas: '0x100000', value: '0x0', transactionIndex: '0x0', type: '0x2' }
		if (method === 'eth_getTransactionReceipt')
			return {
				blockHash,
				blockNumber: '0x64',
				transactionHash: replacementHash,
				from: intent.sender,
				to: feed,
				status: '0x1',
				cumulativeGasUsed: '0x1',
				gasUsed: '0x1',
				transactionIndex: '0x0',
				logs: [{ address: feed, topics, data: '0x', blockHash, blockNumber: '0x64', transactionHash: replacementHash, transactionIndex: '0x0', logIndex: '0x0', removed: false }],
			}
		throw new Error(`Unexpected RPC method ${String(method)}`)
	})
	try {
		const state = initialRuntimeState(true, intent.sender, 1)
		state.pendingTransactions = [intent]
		state.portfolioFunding = { [fundingKey]: { amount: 100n, target: 1n } }
		const runtime = { settings, chain: chainFor(settings), readPool: createRpcEndpointPool([endpoint]) }
		const deps = { state, configurationMutationGate: createConfigurationMutationGate(() => false) }
		const request = { intentHash: intent.hash, replacementHash }
		const blocker = join(directory, 'blocker')
		await writeFile(blocker, '')
		settings.runtime.stateFile = join(blocker, 'state.json')
		await expect(reconcileTransaction(runtime, deps, request)).rejects.toThrow()
		expect(state.pendingTransactions).toHaveLength(1)
		expect(state.sponsoredReports ?? []).toHaveLength(0)
		expect(state.activities).toHaveLength(0)
		settings.runtime.stateFile = join(directory, 'state.json')
		await reconcileTransaction(runtime, deps, request)
		const saved = await loadDurableState(settings.runtime.stateFile, 1)
		expect(saved.pendingTransactions).toHaveLength(0)
		expect(saved.sponsoredReports).toEqual([{ feed, fundingKey, sponsor: intent.sender, reportId: 7n, createdBlock: 100n, nextBlock: 100n }])
		expect(state.sponsoredReports).toEqual(saved.sponsoredReports)
		expect(saved.portfolioFunding?.[fundingKey]?.amount).toBe(100n)
		expect(saved.activities).toHaveLength(1)
	} finally {
		await server.stop(true)
		await rm(directory, { recursive: true, force: true })
	}
})
