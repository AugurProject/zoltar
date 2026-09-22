import { resolveFinalizedReceipt } from '#execution/receipt-transition'
import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWalletClient, defineChain, privateKeyToAccount, type TransactionReceipt } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { parseSettings } from '#config/settings'
import { finalizedReceiptWithQuorum, recoverPendingTransactions, reconcilePendingStagedOperations } from '#execution/recovery'

import { initialRuntimeState, loadDurableState, saveDurableState } from '#state/operator-state'
import { receiptIntent, stagedOperationReceipt } from './receipt-fixtures.ts'

const blockHash = `0x${'11'.repeat(32)}` as const
const descendantHash = `0x${'22'.repeat(32)}` as const
const transactionHash = `0x${'33'.repeat(32)}` as const

function rpcServer(includeEffectiveGasPrice: boolean, receiptBlockHash = blockHash, operationReceipt?: TransactionReceipt) {
	return Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const payload = await request.json()
			if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('Expected a JSON-RPC request object')
			const id = Reflect.get(payload, 'id')
			const method = Reflect.get(payload, 'method')
			const params = Reflect.get(payload, 'params')
			if (method === 'eth_getTransactionReceipt') {
				return Response.json({
					id,
					jsonrpc: '2.0',
					result: {
						blockHash: receiptBlockHash,
						blockNumber: '0x64',
						contractAddress: null,
						cumulativeGasUsed: '0x5208',
						...(includeEffectiveGasPrice ? { effectiveGasPrice: '0x1' } : {}),
						from: operationReceipt?.from ?? '0x0000000000000000000000000000000000000010',
						gasUsed: '0x5208',
						logs: operationReceipt?.logs.map((log, index) => ({ address: log.address, data: log.data, topics: log.topics, blockHash, blockNumber: '0x64', transactionHash: operationReceipt.transactionHash, transactionIndex: '0x0', logIndex: `0x${index.toString(16)}`, removed: false })) ?? [],
						status: operationReceipt?.status === 'reverted' ? '0x0' : '0x1',
						to: operationReceipt?.to ?? '0x0000000000000000000000000000000000000020',
						transactionHash: operationReceipt?.transactionHash ?? transactionHash,
						transactionIndex: '0x0',
						type: '0x2',
					},
				})
			}
			if (method === 'eth_getLogs')
				return Response.json({
					id,
					jsonrpc: '2.0',
					result: operationReceipt?.logs.map((log, index) => ({ address: log.address, data: log.data, topics: log.topics, blockHash, blockNumber: '0x64', transactionHash: operationReceipt.transactionHash, transactionIndex: '0x0', logIndex: `0x${index.toString(16)}`, removed: false })) ?? [],
				})
			if (method === 'eth_blockNumber') return Response.json({ id, jsonrpc: '2.0', result: '0x70' })
			if (method === 'eth_getBlockByNumber') {
				const blockNumber = Array.isArray(params) ? params[0] : undefined
				return Response.json({
					id,
					jsonrpc: '2.0',
					result: {
						hash: blockNumber === '0x64' ? blockHash : descendantHash,
						number: blockNumber,
						timestamp: '0x1',
						transactions: [],
					},
				})
			}
			throw new Error(`Unexpected JSON-RPC method ${String(method)}`)
		},
	})
}

async function recoveryContext(primaryPort: number, secondaryPort: number) {
	const settings = parseSettings(JSON.parse(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).text()))
	settings.connectivity = {
		publicRpcUrls: [],
		quorumRpcUrls: [`http://127.0.0.1:${secondaryPort.toString()}`],
		readRpcUrl: `http://127.0.0.1:${primaryPort.toString()}`,
		rpcQuorum: 2,
	}
	const chain = defineChain({
		id: settings.network.chainId,
		name: 'Receipt recovery test',
		nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
		rpcUrls: { default: { http: [settings.connectivity.readRpcUrl] } },
	})
	return {
		settings,
		wallet: createWalletClient({
			account: privateKeyToAccount(`0x${'01'.repeat(32)}`),
			chain,
			transport: custom({ request: async () => '0x1' }),
		}),
	}
}

test('accepts matching finalized receipt evidence when providers omit optional receipt metadata', async () => {
	const primary = rpcServer(true)
	const secondary = rpcServer(false)
	try {
		if (primary.port === undefined || secondary.port === undefined) throw new Error('Receipt recovery RPCs did not expose ports')
		const { settings, wallet } = await recoveryContext(primary.port, secondary.port)

		const result = await finalizedReceiptWithQuorum(settings, wallet, transactionHash)

		expect(result.observed).toBe(true)
		expect(result.receipt).toMatchObject({ blockHash, blockNumber: 100n, status: 'success', transactionHash })
	} finally {
		primary.stop(true)
		secondary.stop(true)
	}
})

test('rejects finalized receipts whose canonical block evidence disagrees', async () => {
	const primary = rpcServer(true)
	const secondary = rpcServer(false, `0x${'44'.repeat(32)}`)
	try {
		if (primary.port === undefined || secondary.port === undefined) throw new Error('Receipt recovery RPCs did not expose ports')
		const { settings, wallet } = await recoveryContext(primary.port, secondary.port)

		await expect(finalizedReceiptWithQuorum(settings, wallet, transactionHash)).rejects.toThrow('RPC disagreement for receipt')
	} finally {
		primary.stop(true)
		secondary.stop(true)
	}
})

for (const outcome of ['success', 'failure', 'queued', 'reverted', 'conflicting'] as const) {
	test(`restart recovery handles authenticated ${outcome} and preserves ambiguous evidence`, async () => {
		const { intent, receipt } = await receiptIntent(0, outcome === 'queued')
		if (outcome === 'reverted') {
			receipt.status = 'reverted'
			receipt.logs = []
		} else if (outcome !== 'queued') receipt.logs.push(...stagedOperationReceipt(outcome !== 'failure').logs)
		if (outcome === 'conflicting') receipt.logs.push(...stagedOperationReceipt(false).logs)
		// Persisted stale-price expectations must also accept immediate execution.
		intent.receiptExpectation = { type: 'pending-liquidation', coordinator: receipt.to ?? intent.sender, operator: intent.sender, receiver: intent.sender, target: '0x0000000000000000000000000000000000000030', amount: 10n }
		const primary = rpcServer(true, blockHash, receipt)
		const secondary = rpcServer(false, blockHash, receipt)
		const directory = await mkdtemp(join(tmpdir(), 'receipt-recovery-'))
		try {
			if (primary.port === undefined || secondary.port === undefined) throw new Error('RPC ports unavailable')
			const { settings, wallet } = await recoveryContext(primary.port, secondary.port)
			settings.network.chainId = 1
			settings.runtime.stateFile = join(directory, 'state.json')
			const state = initialRuntimeState(false, intent.sender, 1)
			state.pendingTransactions.push(intent)
			await saveDurableState(settings.runtime.stateFile, state)
			state.pendingTransactions = (await loadDurableState(settings.runtime.stateFile, 1)).pendingTransactions
			const recovery = recoverPendingTransactions(settings, wallet, state)
			if (outcome === 'failure' || outcome === 'reverted' || outcome === 'conflicting') await expect(recovery).rejects.toThrow({ conflicting: 'conflicting', failure: 'liquidation too close', reverted: 'reverted' }[outcome])
			else expect(await recovery).toBe(false)
			const loaded = await loadDurableState(settings.runtime.stateFile, 1)
			expect(loaded.pendingTransactions).toHaveLength(outcome === 'conflicting' ? 1 : 0)
			expect(loaded.pendingStagedOperations).toHaveLength(outcome === 'queued' ? 1 : 0)
			if (outcome !== 'conflicting') {
				expect(loaded.activities[0]?.status).toBe(({ queued: 'pending', success: 'confirmed', failure: 'failed', reverted: 'failed' } as const)[outcome])
				expect(await recoverPendingTransactions(settings, wallet, state)).toBe(false)
			}
		} finally {
			primary.stop(true)
			secondary.stop(true)
			await rm(directory, { recursive: true, force: true })
		}
	})
}

for (const operation of [0, 1] as const) {
	for (const success of [true, false]) {
		test(`recovers eventual staged operation ${operation} outcome ${success} after queue journal reload`, async () => {
			const { intent, receipt } = await receiptIntent(operation, true)
			const terminal = stagedOperationReceipt(success, BigInt(operation))
			const primary = rpcServer(true, blockHash, terminal)
			const secondary = rpcServer(false, blockHash, terminal)
			const directory = await mkdtemp(join(tmpdir(), 'staged-recovery-'))
			try {
				if (primary.port === undefined || secondary.port === undefined) throw new Error('RPC ports unavailable')
				const { settings, wallet } = await recoveryContext(primary.port, secondary.port)
				settings.runtime.stateFile = join(directory, 'state.json')
				const state = initialRuntimeState(false, intent.sender, 1)
				state.pendingTransactions.push(intent)
				await resolveFinalizedReceipt(settings.runtime.stateFile, state, intent, receipt)
				state.pendingStagedOperations = (await loadDurableState(settings.runtime.stateFile, 1)).pendingStagedOperations
				const recovery = reconcilePendingStagedOperations(settings, wallet, state)
				if (success) await recovery
				else await expect(recovery).rejects.toThrow('liquidation too close')
				const loaded = await loadDurableState(settings.runtime.stateFile, 1)
				expect(loaded.pendingStagedOperations).toHaveLength(0)
				expect(loaded.activities[0]?.status).toBe(success ? 'confirmed' : 'failed')
				expect(loaded.activities[0]?.kind).toBe(operation === 0 ? 'liquidation' : 'withdrawal')
			} finally {
				primary.stop(true)
				secondary.stop(true)
				await rm(directory, { recursive: true, force: true })
			}
		})
	}
}
