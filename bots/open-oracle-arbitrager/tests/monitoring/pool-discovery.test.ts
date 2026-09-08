import { logMarketDiscoveryFailure } from '#monitoring/market-discovery-status'
import { requireDeployedContracts } from '../../../shared/src/monitoring/deployed-contracts.ts'
import { describe, expect, spyOn, test } from 'bun:test'
import { createPublicClient, custom, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { networkConfiguration } from '#config/network'
import { loadTokenMarkets } from '#monitoring/market-monitor'
import { poolsForToken } from '#monitoring/opportunity-evaluation'

const network = networkConfiguration('sepolia', { rep: zeroAddress })
const config = { network, v2Router: undefined, twapSeconds: 60 }

function clientWithFactory(code: '0x' | '0x01', poolResult = `0x${'0'.repeat(64)}`) {
	let contractCalls = 0
	const codeReads: unknown[] = []
	const client = createPublicClient({
		chain: network.chain,
		transport: custom({
			request: async ({ method, params }) => {
				if (method === 'eth_chainId') return '0xaa36a7'
				if (method === 'eth_getCode') {
					codeReads.push(params)
					return code
				}
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
	return { client, codeReads, contractCalls: () => contractCalls }
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

test('keeps missing V3 factory status for the UI without logging it on each poll', async () => {
	const logged = spyOn(console, 'error').mockImplementation(() => {})
	try {
		for (const discover of [() => poolsForToken(clientWithFactory('0x').client, config, zeroAddress), () => loadTokenMarkets(clientWithFactory('0x').client, { explorerUrl: '', factory: network.factory, chainId: 11155111, tokens: [zeroAddress], weth: zeroAddress, wallet: undefined })]) {
			const discovery: Promise<unknown> = discover()
			const failure: unknown = await discovery.then(
				() => undefined,
				error => error,
			)
			if (!(failure instanceof Error)) throw new Error('Expected discovery to preserve an error for the UI')
			expect(failure).toBeInstanceOf(Error)
			expect(failure.message).toContain('Uniswap V3 factory')
			for (let block = 0; block < 3; block += 1) {
				logMarketDiscoveryFailure('pollFailed=', failure)
				logMarketDiscoveryFailure('report=1 skipped=', failure)
			}
		}
		expect(logged).not.toHaveBeenCalled()
	} finally {
		logged.mockRestore()
	}
})

test('logs genuine failures but presents all confirmed missing deployments as UI notices', async () => {
	const logged = spyOn(console, 'error').mockImplementation(() => {})
	try {
		const rpcFailure = new Error('Uniswap V3 factory RPC unavailable')
		logMarketDiscoveryFailure('pollFailed=', rpcFailure)
		expect(logged).toHaveBeenLastCalledWith(`pollFailed=${rpcFailure.message}`)
		const incompatible: unknown = await poolsForToken(clientWithFactory('0x01', '0x').client, config, zeroAddress).then(
			() => undefined,
			error => error,
		)
		if (!(incompatible instanceof Error)) throw new Error('Expected discovery to preserve an error for the UI')
		logMarketDiscoveryFailure('pollFailed=', incompatible)
		expect(logged).toHaveBeenLastCalledWith(`pollFailed=${incompatible.message}`)
		const missing: unknown = await requireDeployedContracts(clientWithFactory('0x').client, [
			{ name: 'Uniswap V3 factory', address: network.factory },
			{ name: 'OpenOracle', address: zeroAddress },
		]).then(
			() => undefined,
			error => error,
		)
		if (!(missing instanceof Error)) throw new Error('Expected discovery to preserve an error for the UI')
		logMarketDiscoveryFailure('pollFailed=', missing)
		expect(logged).toHaveBeenCalledTimes(2)
	} finally {
		logged.mockRestore()
	}
})

test('checks factory deployment at the displayed cycle block', async () => {
	const missing = clientWithFactory('0x')
	await expect(poolsForToken(missing.client, config, zeroAddress, 100n)).rejects.toThrow('block 100')
	expect(missing.codeReads).toEqual([[network.factory, '0x64']])
	const overview = clientWithFactory('0x')
	await expect(loadTokenMarkets(overview.client, { blockNumber: 100n, explorerUrl: '', factory: network.factory, chainId: 11155111, tokens: [], weth: zeroAddress, wallet: undefined })).rejects.toThrow('block 100')
	expect(overview.codeReads).toEqual([[network.factory, '0x64']])
})
