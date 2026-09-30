import { expect, test } from 'bun:test'
import { encodeAbiParameters, encodeFunctionData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createInjectedBackend } from '../wallet/chainBackend.js'
import { SEPOLIA_NETWORK_PROFILE } from '../wallet/networkProfile.js'
import type { InjectedEthereum } from '../wallet/injectedEthereum.js'
import { installFetchStub } from './testUtils/fetchStub.js'

const hash = `0x${'ab'.repeat(32)}` as const
const abi = [{ type: 'function', name: 'quote', stateMutability: 'payable', inputs: [], outputs: [{ type: 'uint256' }] }] as const

test('injected read and wallet simulation clients send hash-pinned calls directly to the configured RPC', async () => {
	const walletMethods: string[] = []
	const rpcCalls: unknown[] = []
	let rejectPinnedRead = false
	const provider: InjectedEthereum = {
		request: async ({ method, params }) => {
			walletMethods.push(method)
			if (method === 'eth_call') {
				if (Array.isArray(params) && typeof params[1] === 'object') throw new TypeError('c.slice is not a function')
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
		if (rejectPinnedRead) return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'Requested block is not canonical' } })
		return Response.json({ jsonrpc: '2.0', id: body.id, result: encodeAbiParameters([{ type: 'uint256' }], [42n]) })
	})
	try {
		const backend = createInjectedBackend({ profile: SEPOLIA_NETWORK_PROFILE, provider, rpcUrl: 'https://rpc.example' })
		const request = { abi, address: zeroAddress, functionName: 'quote', blockHash: hash } as const
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
		expect(walletMethods).toEqual([])
		expect(await backend.createReadClient().readContract({ abi, address: zeroAddress, functionName: 'quote' })).toBe(1n)
		expect(walletMethods).toEqual(['eth_call'])
		rejectPinnedRead = true
		await expect(backend.createWriteClient(zeroAddress).simulateContract(request)).rejects.toThrow('Requested block is not canonical')
		expect(walletMethods).toEqual(['eth_call'])
	} finally {
		restore()
	}
})
