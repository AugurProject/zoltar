import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWalletClient, defineChain, privateKeyToAccount, type TransactionReceipt } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { parseSettings } from '#config/settings'
import { finalizedReceiptWithQuorum, recoverPendingTransactions } from '#execution/recovery'

import { initialRuntimeState, loadDurableState, saveDurableState } from '#state/operator-state'
import { portfolioReceiptIntent } from './portfolio-receipt-fixture.ts'

const blockHash = `0x${'11'.repeat(32)}` as const
const descendantHash = `0x${'22'.repeat(32)}` as const
const transactionHash = `0x${'33'.repeat(32)}` as const

function rpcServer(includeEffectiveGasPrice: boolean, receiptBlockHash = blockHash, operationReceipt?: TransactionReceipt, pendingNonce?: number) {
	return Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const payload = await request.json()
			if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('Expected a JSON-RPC request object')
			const id = Reflect.get(payload, 'id')
			const method = Reflect.get(payload, 'method')
			const params = Reflect.get(payload, 'params')
			if (method === 'eth_getTransactionCount') return Response.json({ id, jsonrpc: '2.0', result: `0x${(pendingNonce ?? 0).toString(16)}` })
			if (method === 'eth_getTransactionReceipt') {
				if (pendingNonce !== undefined) return Response.json({ id, jsonrpc: '2.0', result: null })
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

for (const status of ['success', 'reverted'] as const) {
	test(`restart recovery handles a finalized portfolio ${status}`, async () => {
		const { intent, receipt } = await portfolioReceiptIntent()
		receipt.status = status
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
			if (status === 'reverted') await expect(recovery).rejects.toThrow('reverted')
			else expect(await recovery).toBe(false)
			const loaded = await loadDurableState(settings.runtime.stateFile, 1)
			expect(loaded.pendingTransactions).toHaveLength(0)
			expect(loaded.activities[0]?.status).toBe(status === 'success' ? 'confirmed' : 'failed')
		} finally {
			primary.stop(true)
			secondary.stop(true)
			await rm(directory, { recursive: true, force: true })
		}
	})
}

for (const nonce of [0, 1]) {
	test(`retains ambiguous portfolio intent with signer nonce ${nonce} instead of replaying stale decisions`, async () => {
		const { intent, receipt } = await portfolioReceiptIntent()
		const primary = rpcServer(true, blockHash, receipt, nonce)
		const secondary = rpcServer(false, blockHash, receipt, nonce)
		const directory = await mkdtemp(join(tmpdir(), 'portfolio-ambiguous-'))
		try {
			if (primary.port === undefined || secondary.port === undefined) throw new Error('RPC ports unavailable')
			const { settings, wallet } = await recoveryContext(primary.port, secondary.port)
			settings.network.chainId = 1
			settings.runtime.stateFile = join(directory, 'state.json')
			const state = initialRuntimeState(false, intent.sender, 1)
			state.pendingTransactions.push(intent)
			await expect(recoverPendingTransactions(settings, wallet, state)).rejects.toThrow(nonce === 0 ? 'automatic replay is disabled' : 'nonce was consumed')
			expect(state.pendingTransactions).toHaveLength(1)
			const loaded = await loadDurableState(settings.runtime.stateFile, 1)
			expect(loaded.pendingTransactions[0]?.hash).toBe(intent.hash)
			expect(loaded.pendingTransactions[0]?.reconciliationReason).toContain('reconcile its receipt or replace signer nonce')
		} finally {
			primary.stop(true)
			secondary.stop(true)
			await rm(directory, { recursive: true, force: true })
		}
	})
}
