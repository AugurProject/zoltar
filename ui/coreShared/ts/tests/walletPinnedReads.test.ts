import { expect, test } from 'bun:test'
import { encodeAbiParameters, encodeFunctionData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createInjectedBackend } from '../wallet/chainBackend.js'
import { SEPOLIA_NETWORK_PROFILE } from '../wallet/networkProfile.js'
import type { InjectedEthereum } from '../wallet/injectedEthereum.js'
import { installFetchStub } from './testUtils/fetchStub.js'

const hash = `0x${'ab'.repeat(32)}` as const
const abi = [{ type: 'function', name: 'quote', stateMutability: 'payable', inputs: [], outputs: [{ type: 'uint256' }] }] as const

test('keeps pinned reads and simulations on the wallet and propagates failures without an RPC fallback', async () => {
	const walletCalls: unknown[] = []
	let walletFailure: unknown
	const provider: InjectedEthereum = {
		request: async parameters => {
			walletCalls.push(parameters)
			if (walletFailure !== undefined) throw walletFailure
			return encodeAbiParameters([{ type: 'uint256' }], [1n])
		},
	}
	let rpcRequests = 0
	const restore = installFetchStub(async () => {
		rpcRequests += 1
		return Response.json({ jsonrpc: '2.0', id: 1, result: encodeAbiParameters([{ type: 'uint256' }], [42n]) })
	})
	try {
		const backend = createInjectedBackend({ profile: SEPOLIA_NETWORK_PROFILE, provider, rpcUrl: 'https://rpc.example' })
		const request = { abi, address: zeroAddress, functionName: 'quote', blockHash: hash } as const
		expect(await backend.createReadClient().readContract(request)).toBe(1n)
		expect((await backend.createWriteClient(zeroAddress).simulateContract({ ...request, value: 100_000_000_000_000_000n })).result).toBe(1n)
		expect(walletCalls).toEqual([
			{
				method: 'eth_call',
				params: [
					{ to: zeroAddress, data: encodeFunctionData({ abi, functionName: 'quote' }) },
					{ blockHash: hash, requireCanonical: true },
				],
			},
			{
				method: 'eth_call',
				params: [
					{ from: zeroAddress, to: zeroAddress, data: encodeFunctionData({ abi, functionName: 'quote' }), value: '0x16345785d8a0000' },
					{ blockHash: hash, requireCanonical: true },
				],
			},
		])
		for (const failure of [
			{ code: -32603, message: 'c.slice is not a function' },
			{ code: 4001, message: 'User rejected' },
			{ code: 3, message: 'execution reverted: Stale price' },
			{ code: -32603, message: 'Unrelated internal error' },
		]) {
			walletFailure = failure
			await expect(backend.createReadClient().readContract(request)).rejects.toThrow(failure.message)
			await expect(backend.createWriteClient(zeroAddress).simulateContract(request)).rejects.toThrow(failure.message)
		}
		expect(rpcRequests).toBe(0)
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
