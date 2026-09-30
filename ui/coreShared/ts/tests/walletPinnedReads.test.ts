import { expect, test } from 'bun:test'
import { encodeAbiParameters, encodeFunctionData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createInjectedBackend } from '../wallet/chainBackend.js'
import { SEPOLIA_NETWORK_PROFILE } from '../wallet/networkProfile.js'
import type { InjectedEthereum } from '../wallet/injectedEthereum.js'
import { installFetchStub } from './testUtils/fetchStub.js'

const hash = `0x${'ab'.repeat(32)}` as const
const abi = [{ type: 'function', name: 'quote', stateMutability: 'payable', inputs: [], outputs: [{ type: 'uint256' }] }] as const

test('injected read and wallet simulation clients retry only the wallet internal slice error without changing the pinned call', async () => {
	const walletMethods: string[] = []
	const rpcCalls: unknown[] = []
	let rejectPinnedRead: string | undefined
	let walletFailure: unknown
	const provider: InjectedEthereum = {
		request: async ({ method }) => {
			walletMethods.push(method)
			if (method === 'eth_call') {
				if (walletFailure !== undefined) throw walletFailure
				return encodeAbiParameters([{ type: 'uint256' }], [1n])
			}
			throw new Error(`Unexpected wallet method ${method}`)
		},
	}
	const restore = installFetchStub(async (url, init) => {
		expect(String(url)).toBe('https://rpc.example')
		if (typeof init?.body !== 'string') throw new Error('Expected RPC body')
		const body = JSON.parse(init.body)
		expect(body.method).toBe('eth_call')
		rpcCalls.push(body.params)
		if (rejectPinnedRead !== undefined) return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: 3, message: rejectPinnedRead } })
		return Response.json({ jsonrpc: '2.0', id: body.id, result: encodeAbiParameters([{ type: 'uint256' }], [42n]) })
	})
	try {
		const backend = createInjectedBackend({ profile: SEPOLIA_NETWORK_PROFILE, provider, rpcUrl: 'https://rpc.example' })
		const request = { abi, address: zeroAddress, functionName: 'quote', blockHash: hash } as const
		expect(await backend.createReadClient().readContract(request)).toBe(1n)
		expect(rpcCalls).toEqual([])
		walletFailure = { code: -32603, message: 'c.slice is not a function' }
		expect(await backend.createReadClient().readContract(request)).toBe(42n)
		expect((await backend.createWriteClient(zeroAddress).simulateContract({ ...request, value: 100_000_000_000_000_000n })).result).toBe(42n)
		expect(rpcCalls).toEqual([
			[
				{ to: zeroAddress, data: encodeFunctionData({ abi, functionName: 'quote' }) },
				{ blockHash: hash, requireCanonical: true },
			],
			[
				{ from: zeroAddress, to: zeroAddress, data: encodeFunctionData({ abi, functionName: 'quote' }), value: '0x16345785d8a0000' },
				{ blockHash: hash, requireCanonical: true },
			],
		])
		expect(walletMethods).toEqual(['eth_call', 'eth_call', 'eth_call'])
		walletFailure = undefined
		expect(await backend.createReadClient().readContract({ abi, address: zeroAddress, functionName: 'quote' })).toBe(1n)
		expect(walletMethods).toHaveLength(4)
		rejectPinnedRead = 'Requested block is not canonical'
		walletFailure = { code: -32603, message: 'c.slice is not a function' }
		await expect(backend.createWriteClient(zeroAddress).simulateContract(request)).rejects.toThrow('Requested block is not canonical')
		expect(walletMethods).toHaveLength(5)
		rejectPinnedRead = 'execution reverted: Stale price'
		await expect(backend.createWriteClient(zeroAddress).simulateContract(request)).rejects.toThrow('Stale price')
		const rpcCount = rpcCalls.length
		for (const failure of [
			{ code: 4001, message: 'User rejected' },
			{ code: 3, message: 'execution reverted: Stale price' },
			{ code: -32603, message: 'Unrelated internal error' },
		]) {
			walletFailure = failure
			await expect(backend.createReadClient().readContract(request)).rejects.toThrow(failure.message)
		}
		expect(rpcCalls).toHaveLength(rpcCount)
	} finally {
		restore()
	}
})

test('never retries a wallet send with the slice error against the public RPC', async () => {
	const methods: string[] = []
	const provider: InjectedEthereum = {
		request: async ({ method }) => {
			methods.push(method)
			if (method === 'eth_accounts') return [zeroAddress]
			if (method === 'eth_chainId') return '0xaa36a7'
			throw { code: -32603, message: 'c.slice is not a function' }
		},
	}
	let rpcRequests = 0
	const restore = installFetchStub(async () => {
		rpcRequests += 1
		throw new Error('Unexpected RPC fallback')
	})
	try {
		const backend = createInjectedBackend({ profile: SEPOLIA_NETWORK_PROFILE, provider, rpcUrl: 'https://rpc.example' })
		await expect(backend.createWriteClient(zeroAddress).sendTransaction({ to: zeroAddress, value: 1n })).rejects.toThrow('c.slice is not a function')
		expect(methods).toContain('eth_sendTransaction')
		expect(rpcRequests).toBe(0)
	} finally {
		restore()
	}
})
