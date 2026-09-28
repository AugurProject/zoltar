import { expect, test } from 'bun:test'
import { custom, encodeAbiParameters, requestRpc, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createInjectedBackend } from '../wallet/chainBackend.js'
import { createConfirmedReadTransport } from '../wallet/confirmedReadTransport.js'
import type { InjectedEthereum } from '../wallet/injectedEthereum.js'
import { installFetchStub } from './testUtils/fetchStub.js'

const hash = `0x${'ab'.repeat(32)}` as const
const allowanceAbi = [
	{
		type: 'function',
		name: 'allowance',
		stateMutability: 'view',
		inputs: [
			{ name: 'owner', type: 'address' },
			{ name: 'spender', type: 'address' },
		],
		outputs: [{ type: 'uint256' }],
	},
] as const
const allowanceRequest = { address: zeroAddress, abi: allowanceAbi, functionName: 'allowance', args: [zeroAddress, zeroAddress] } as const

function createApprovalRpc(amount: bigint) {
	let head = 9n
	let receiptBlock = 10n
	const calls: unknown[] = []
	const request: InjectedEthereum['request'] = async ({ method, params }) => {
		if (method === 'eth_blockNumber') return `0x${head.toString(16)}`
		if (method === 'eth_getTransactionReceipt') return { blockHash: hash, blockNumber: `0x${receiptBlock.toString(16)}`, cumulativeGasUsed: '0x5208', effectiveGasPrice: '0x1', from: zeroAddress, gasUsed: '0x5208', logs: [], status: '0x1', to: zeroAddress, transactionHash: hash, transactionIndex: '0x0', type: '0x2' }
		if (method === 'eth_call') {
			if (!Array.isArray(params)) throw new Error('Expected call parameters')
			const block = params[1]
			calls.push(block)
			// Model a wallet that still caches the pre-approval answer for `latest`.
			return encodeAbiParameters([{ type: 'uint256' }], [block === 'latest' || block === '0x9' ? 0n : amount])
		}
		throw new Error(`Unexpected RPC ${method}`)
	}
	return {
		request,
		calls,
		setHead: (value: bigint) => {
			head = value
		},
		setReceiptBlock: (value: bigint) => {
			receiptBlock = value
		},
	}
}

for (const mode of ['provider', 'rpc'] as const) {
	for (const rep of [2n, 200n]) {
		test(`${mode} reads observe a confirmed ${rep} REP approval despite stale latest data`, async () => {
			const amount = rep * 10n ** 18n
			const rpc = createApprovalRpc(amount)
			const restoreFetch = installFetchStub(async (_input, init) => {
				if (typeof init?.body !== 'string') throw new Error('Expected JSON RPC body')
				const body = JSON.parse(init.body)
				return Response.json({ jsonrpc: '2.0', id: body.id, result: await rpc.request(body) })
			})
			try {
				const backend = createInjectedBackend({ provider: { request: rpc.request }, rpcUrl: 'https://rpc.example' })
				backend.setReadTransportMode?.(mode)
				const readClient = backend.createReadClient()
				expect(await readClient.readContract(allowanceRequest)).toBe(0n)
				await backend.createWriteClient(zeroAddress).waitForTransactionReceipt({ hash })
				expect(await readClient.readContract(allowanceRequest)).toBe(amount)
				expect(await backend.createReadClient().readContract(allowanceRequest)).toBe(amount)
				expect(rpc.calls.slice(-2)).toEqual(['0xa', '0xa'])
				// Transaction preflights use a wallet client rather than the read client.
				expect(await backend.createWriteClient(zeroAddress).readContract(allowanceRequest)).toBe(amount)
				// A receipt is a lower bound, not a permanent snapshot of the chain.
				rpc.setHead(12n)
				await readClient.readContract(allowanceRequest)
				expect(rpc.calls.at(-1)).toBe('0xc')
				expect(await readClient.readContract({ ...allowanceRequest, blockNumber: 9n })).toBe(0n)
				await readClient.readContract({ ...allowanceRequest, blockTag: 'pending' })
				expect(rpc.calls.at(-1)).toBe('pending')
				await readClient.readContract({ ...allowanceRequest, blockHash: hash })
				expect(rpc.calls.at(-1)).toEqual({ blockHash: hash, requireCanonical: true })
			} finally {
				restoreFetch()
			}
		})
	}
}

test('an allowance read already in flight at confirmation cannot publish its pre-approval answer', async () => {
	const rpc = createApprovalRpc(2n)
	let release: (() => void) | undefined
	const pending = new Promise<void>(resolve => {
		release = resolve
	})
	let started: (() => void) | undefined
	const reading = new Promise<void>(resolve => {
		started = resolve
	})
	const provider: InjectedEthereum = {
		request: async parameters => {
			const result = await rpc.request(parameters)
			if (parameters.method === 'eth_call' && Array.isArray(parameters.params) && parameters.params[1] === 'latest') {
				started?.()
				await pending
			}
			return result
		},
	}
	const backend = createInjectedBackend({ provider })
	const allowance = backend.createReadClient().readContract(allowanceRequest)
	await reading
	await backend.createWriteClient(zeroAddress).waitForTransactionReceipt({ hash })
	release?.()
	expect(await allowance).toBe(2n)
})

test('confirmation blocks do not regress when receipts finish out of order or leak into another backend', async () => {
	const rpc = createApprovalRpc(200n)
	const backend = createInjectedBackend({ provider: { request: rpc.request } })
	rpc.setReceiptBlock(12n)
	await backend.createWriteClient(zeroAddress, { onTransactionSubmitted: () => undefined }).waitForTransactionReceipt({ hash })
	rpc.setReceiptBlock(10n)
	await backend.createWriteClient(zeroAddress).waitForTransactionReceipt({ hash })
	await backend.createReadClient().readContract(allowanceRequest)
	expect(rpc.calls.at(-1)).toBe('0xc')
	const otherBackend = createInjectedBackend({ provider: { request: rpc.request } })
	expect(await otherBackend.createReadClient().readContract(allowanceRequest)).toBe(0n)
})

test('a read RPC that cannot serve the confirmed block reports an error instead of falling back to stale allowance', async () => {
	const rpc = createApprovalRpc(2n)
	const provider: InjectedEthereum = {
		request: async parameters => {
			if (parameters.method === 'eth_call' && Array.isArray(parameters.params) && parameters.params[1] !== 'latest') throw new Error('Confirmed block is not available yet')
			return await rpc.request(parameters)
		},
	}
	const backend = createInjectedBackend({ provider })
	await backend.createWriteClient(zeroAddress).waitForTransactionReceipt({ hash })
	await expect(backend.createReadClient().readContract(allowanceRequest)).rejects.toThrow('Confirmed block is not available yet')
})

for (const [method, params, expected] of [
	['eth_getBalance', [zeroAddress, 'latest'], [zeroAddress, '0xa']],
	['eth_getCode', [zeroAddress, 'latest'], [zeroAddress, '0xa']],
	['eth_getTransactionCount', [zeroAddress, 'latest'], [zeroAddress, '0xa']],
	['eth_getStorageAt', [zeroAddress, '0x0', 'latest'], [zeroAddress, '0x0', '0xa']],
	['eth_getBlockByNumber', ['latest', false], ['0xa', false]],
] as const) {
	test(`${method} shares the confirmation boundary with allowance reads`, async () => {
		const transport = createConfirmedReadTransport(custom({ request: async request => (request.method === 'eth_blockNumber' ? '0x9' : request.params) }), () => 10n)
		expect(await requestRpc(transport, { method, params })).toEqual(expected)
	})
}
