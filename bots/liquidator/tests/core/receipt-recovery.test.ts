import { expect, test } from 'bun:test'
import { createWalletClient, custom, defineChain, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { parseSettings } from '#config/settings'
import { finalizedReceiptWithQuorum } from '#execution/recovery'

const blockHash = `0x${'11'.repeat(32)}` as const
const descendantHash = `0x${'22'.repeat(32)}` as const
const transactionHash = `0x${'33'.repeat(32)}` as const

function rpcServer(includeEffectiveGasPrice: boolean, receiptBlockHash = blockHash) {
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
						from: '0x0000000000000000000000000000000000000010',
						gasUsed: '0x5208',
						logs: [],
						status: '0x1',
						to: '0x0000000000000000000000000000000000000020',
						transactionHash,
						transactionIndex: '0x0',
						type: '0x2',
					},
				})
			}
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
