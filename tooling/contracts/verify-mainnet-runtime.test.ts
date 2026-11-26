import { expect, test } from 'bun:test'
import { custom, keccak256 } from '@zoltar/core-shared/evm/ethereum'
import { verifyMainnetRuntime, mainnetTargets } from './verify-mainnet-runtime.mts'
import { PERMIT2_ADDRESS } from './uniswap-deployment.mts'
import yes from '../../docs/mainnet-deployment-addresses.json'
import no from '../../docs/mainnet-no-deployment-addresses.json'

const hash = keccak256('0xab')
test('both profiles cover every manifest address and have runtime pins', () => {
	for (const [genesis, manifest] of [
		['yes', yes],
		['no', no],
	] as const) {
		const pins = Object.fromEntries([manifest.network.genesisRepTokenAddress, manifest.network.wethAddress, PERMIT2_ADDRESS].map(address => [address.toLowerCase(), { hash, source: 'test' }]))
		const targets = mainnetTargets(genesis, pins)
		for (const step of [...manifest.deploymentSteps, ...manifest.derivedContracts]) expect(targets.find(target => target.id === step.id)?.address.toLowerCase()).toBe(step.address.toLowerCase())
		expect(targets.find(target => target.id === 'permit2')?.address).toBe(PERMIT2_ADDRESS)
		expect(targets.every(target => target.expectedRuntimeCodeHash?.length === 66)).toBe(true)
		expect(() => mainnetTargets(genesis, {})).toThrow('independently reviewed')
	}
})

test('verification reads only canonical finalized state and records missing and incorrect code', async () => {
	const results = ['0xab', '0x', '0xcd']
	const transport = custom({
		request: async ({ method, params }) => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_getBlockByNumber') {
				expect(params).toEqual(['finalized', false])
				return { hash, number: '0x123' }
			}
			expect(method).toBe('eth_getCode')
			expect(Array.isArray(params) && params[1]).toEqual({ blockHash: hash, requireCanonical: true })
			return results.shift()
		},
	})
	const targets = ['a', 'b', 'c'].map(id => ({ id, address: '0x' + id.repeat(40), expectedRuntimeCodeHash: hash, source: 'test' }))
	const report = await verifyMainnetRuntime(transport, [
		{ genesis: 'yes', targets },
		{ genesis: 'no', targets },
	])
	expect(report.verified).toBe(false)
	expect(report.results.map(row => row.status)).toEqual(['match', 'missing', 'mismatch', 'match', 'missing', 'mismatch'])
})

test('a wrong chain or unavailable finalized block aborts before reading code', async () => {
	await expect(verifyMainnetRuntime(custom({ request: async () => '0xaa36a7' }), [])).rejects.toThrow('mainnet')
	await expect(verifyMainnetRuntime(custom({ request: async ({ method }) => (method === 'eth_chainId' ? '0x1' : undefined) }), [])).rejects.toThrow('finalized block')
})

test.each(['0xab', '0x', '0xcd'])('#1723 Permit2 runtime is part of verification (%s)', async code => {
	const transport = custom({
		request: async ({ method }) => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_getBlockByNumber') return { hash, number: '0x123' }
			return code
		},
	})
	const report = await verifyMainnetRuntime(transport, [{ genesis: 'yes', targets: [{ id: 'permit2', address: PERMIT2_ADDRESS, expectedRuntimeCodeHash: hash, source: 'reviewed fixture' }] }])
	expect(report.verified).toBe(code === '0xab')
	const expected = new Map([
		['0xab', 'match'],
		['0x', 'missing'],
		['0xcd', 'mismatch'],
	])
	expect(report.results[0]?.status).toBe(expected.get(code))
})
