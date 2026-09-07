import { describe, expect, test } from 'bun:test'
import { createPublicClient, custom, zeroAddress } from '#ethereum'
import { networkConfiguration } from '#config/network'
import { loadTokenMarkets } from '#monitoring/market-monitor'
import { poolsForToken } from '#monitoring/opportunity-evaluation'

const network = networkConfiguration('sepolia', { rep: zeroAddress })
const config = { network, v2Router: undefined, twapSeconds: 60 }

function clientWithFactory(code: '0x' | '0x01', poolResult = `0x${'0'.repeat(64)}`) {
	let contractCalls = 0
	const client = createPublicClient({
		chain: network.chain,
		transport: custom({
			request: async ({ method, params }) => {
				if (method === 'eth_chainId') return '0xaa36a7'
				if (method === 'eth_getCode') return code
				if (method === 'eth_call') {
					contractCalls += 1
					const input = JSON.stringify(params) ?? ''
					if (input.includes('0x06fdde03') || input.includes('0x95d89b41')) return `0x${'20'.padStart(64, '0')}${'3'.padStart(64, '0')}${'524550'.padEnd(64, '0')}`
					if (input.includes('0x313ce567')) return `0x${'12'.padStart(64, '0')}`
					return poolResult
				}
				throw new Error(`Unexpected method ${method}`)
			},
		}),
	})
	return { client, contractCalls: () => contractCalls }
}

describe('Uniswap factory discovery', () => {
	test('distinguishes an undeployed factory from an empty pool inventory', async () => {
		const missing = clientWithFactory('0x')
		await expect(poolsForToken(missing.client, config, zeroAddress)).rejects.toThrow('Uniswap V3 factory')
		expect(missing.contractCalls()).toBe(0)
		const deployed = clientWithFactory('0x01')
		expect(await poolsForToken(deployed.client, config, zeroAddress)).toEqual([])
		expect(deployed.contractCalls()).toBe(4)
	})

	test('surfaces incompatible factory reads instead of silently skipping every fee', async () => {
		const incompatible = clientWithFactory('0x01', '0x')
		await expect(poolsForToken(incompatible.client, config, zeroAddress)).rejects.toThrow('getPool')
		expect(incompatible.contractCalls()).toBe(1)
	})
})

test('market overview propagates incompatible factory reads', async () => {
	const incompatible = clientWithFactory('0x01', '0x')
	await expect(loadTokenMarkets(incompatible.client, { explorerUrl: '', factory: network.factory, chainId: 11155111, tokens: [zeroAddress], weth: zeroAddress, wallet: undefined })).rejects.toThrow('getPool')
})
