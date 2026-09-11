import { logMarketDiscoveryFailure } from '#monitoring/market-discovery-status'
import { requireDeployedContracts } from '@zoltar/bot-shared/monitoring/deployed-contracts'
import { describe, expect, spyOn, test } from 'bun:test'
import { createPublicClient, decodeFunctionData, encodeAbiParameters, getAddress, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { erc20Abi, factoryAbi, poolAbi } from '#contracts/abi'
import { networkConfiguration } from '#config/network'
import { createTokenMetadataCache, discoverTokenPools, loadTokenMarkets } from '#monitoring/market-monitor'
import { poolsForTokens } from '#monitoring/opportunity-evaluation'
import { multicallProvider } from '../helpers/multicall-provider.ts'

const network = networkConfiguration('sepolia', {})
const config = { network, v2Router: undefined, twapSeconds: 60 }
const token = getAddress('0x0000000000000000000000000000000000000abc')
const pool500 = getAddress('0x0000000000000000000000000000000000000500')
const pool3000 = getAddress('0x0000000000000000000000000000000000003000')
const emptyPool = getAddress('0x0000000000000000000000000000000000010000')

type PoolState = { liquidity: bigint; slot0?: 'invalid' | undefined; tick: bigint; tickCumulatives: readonly [bigint, bigint] }

function clientWithFactory(code: '0x' | '0x01', options: { pools?: Map<string, PoolState> | undefined; poolResult?: 'invalid' | ((fee: number) => Address) | undefined } = {}) {
	let contractCalls = 0
	let batchedCalls = 0
	const codeReads: unknown[] = []
	const provider = multicallProvider(
		network.multicall3,
		({ data, to }) => {
			contractCalls += 1
			if (to.toLowerCase() === network.factory.toLowerCase()) {
				const decoded = decodeFunctionData({ abi: factoryAbi, data })
				if (decoded.functionName !== 'getPool') throw new Error(`Unexpected factory read ${decoded.functionName}`)
				if (options.poolResult === 'invalid') return '0x'
				return encodeAbiParameters([{ type: 'address' }], [options.poolResult === undefined ? zeroAddress : options.poolResult(Number(decoded.args[2]))])
			}
			const pool = options.pools?.get(to.toLowerCase())
			if (pool !== undefined) {
				const decoded = decodeFunctionData({ abi: poolAbi, data })
				if (decoded.functionName === 'liquidity') return encodeAbiParameters([{ type: 'uint128' }], [pool.liquidity])
				if (decoded.functionName === 'slot0') {
					if (pool.slot0 === 'invalid') return '0x'
					return encodeAbiParameters([{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }], [2n ** 96n, pool.tick, 0n, 1n, 1n, 0n, true])
				}
				return encodeAbiParameters([{ type: 'int56[]' }, { type: 'uint160[]' }], [pool.tickCumulatives, [0n, 0n]])
			}
			if (to.toLowerCase() === token.toLowerCase()) {
				const decoded = decodeFunctionData({ abi: erc20Abi, data })
				if (decoded.functionName === 'name') return encodeAbiParameters([{ type: 'string' }], ['Reputation'])
				if (decoded.functionName === 'symbol') return encodeAbiParameters([{ type: 'string' }], ['REP'])
				if (decoded.functionName === 'decimals') return encodeAbiParameters([{ type: 'uint8' }], [18n])
			}
			throw new Error(`Unexpected contract read ${to}`)
		},
		({ method, params }) => {
			if (method === 'eth_chainId') return '0xaa36a7'
			if (method === 'eth_getCode') {
				codeReads.push(params)
				return code
			}
			throw new Error(`Unexpected method ${method}`)
		},
	)
	const client = createPublicClient({
		chain: network.chain,
		transport: custom({
			request: parameters => {
				if (parameters.method === 'eth_call') batchedCalls += 1
				return provider.request(parameters)
			},
		}),
	})
	return { batchedCalls: () => batchedCalls, client, codeReads, contractCalls: () => contractCalls }
}

const discover = (client: ReturnType<typeof clientWithFactory>['client'], blockNumber?: bigint) => discoverTokenPools(client, { blockNumber, chainId: 11155111, factory: network.factory, multicall3: network.multicall3, tokens: [token], weth: network.weth })

describe('Uniswap factory discovery', () => {
	test('distinguishes an undeployed factory from an empty pool inventory', async () => {
		const missing = clientWithFactory('0x')
		await expect(discover(missing.client)).rejects.toThrow('Uniswap V3 factory')
		expect(missing.contractCalls()).toBe(0)
		const deployed = clientWithFactory('0x01')
		expect(await discover(deployed.client)).toEqual([{ constantProduct: [], token, v3: [] }])
		// Every fee tier is resolved through one batched request.
		expect(deployed.contractCalls()).toBe(4)
		expect(deployed.batchedCalls()).toBe(1)
	})

	test('surfaces incompatible factory reads instead of silently skipping every fee', async () => {
		const incompatible = clientWithFactory('0x01', { poolResult: 'invalid' })
		await expect(discover(incompatible.client)).rejects.toThrow('getPool')
		expect(incompatible.batchedCalls()).toBe(1)
	})

	test('verifies the factory once per client instead of on every poll', async () => {
		const deployed = clientWithFactory('0x01')
		await discover(deployed.client, 100n)
		await discover(deployed.client, 101n)
		expect(deployed.codeReads).toEqual([[network.factory, '0x64']])
	})
})

test('loads pool state for every discovered pool in one batch and drops empty pools', async () => {
	const pools = new Map<string, PoolState>([
		[pool500.toLowerCase(), { liquidity: 10n, tick: 5n, tickCumulatives: [0n, 600n] }],
		[pool3000.toLowerCase(), { liquidity: 20n, tick: -7n, tickCumulatives: [0n, -601n] }],
		[emptyPool.toLowerCase(), { liquidity: 0n, tick: 0n, tickCumulatives: [0n, 0n] }],
	])
	const deployed = clientWithFactory('0x01', { poolResult: fee => (fee === 500 ? pool500 : fee === 3000 ? pool3000 : fee === 10000 ? emptyPool : zeroAddress), pools })
	const discovered = await discover(deployed.client, 100n)
	expect(discovered[0]?.v3).toEqual([
		{ address: pool500, fee: 500 },
		{ address: pool3000, fee: 3000 },
		{ address: emptyPool, fee: 10000 },
	])
	const loaded = await poolsForTokens(deployed.client, config, discovered, 100n)
	expect(loaded).toEqual([
		{ address: pool500, fee: 500, liquidity: 10n, spotTick: 5n, token, twapTick: 10n, v2Pair: undefined },
		{ address: pool3000, fee: 3000, liquidity: 20n, spotTick: -7n, token, twapTick: -11n, v2Pair: undefined },
	])
	expect(deployed.batchedCalls()).toBe(2)
})

test('market overview skips one unreadable pool while keeping the token and caches its metadata', async () => {
	const logged = spyOn(console, 'error').mockImplementation(() => {})
	try {
		const pools = new Map<string, PoolState>([
			[pool500.toLowerCase(), { liquidity: 10n, tick: 5n, tickCumulatives: [0n, 600n] }],
			[pool3000.toLowerCase(), { liquidity: 20n, slot0: 'invalid', tick: 0n, tickCumulatives: [0n, 0n] }],
		])
		const deployed = clientWithFactory('0x01', { poolResult: fee => (fee === 500 ? pool500 : fee === 3000 ? pool3000 : zeroAddress), pools })
		const discovered = await discover(deployed.client, 100n)
		const metadataCache = createTokenMetadataCache()
		const parameters = { blockNumber: 100n, explorerUrl: 'https://explorer.example', metadataCache, multicall3: network.multicall3, pools: discovered, wallet: undefined, weth: network.weth }
		const markets = await loadTokenMarkets(deployed.client, parameters)
		expect(markets).toEqual([{ address: token, balance: undefined, decimals: 18, name: 'Reputation', pools: [{ address: pool500, fee: 500, liquidity: '10', priceWeth: '1', url: `https://explorer.example/address/${pool500}`, venue: 'Uniswap V3' }], symbol: 'REP' }])
		expect(logged).toHaveBeenCalledTimes(1)
		const callsBefore = deployed.contractCalls()
		await loadTokenMarkets(deployed.client, parameters)
		// The second overview reuses the cached name, symbol, and decimals.
		expect(deployed.contractCalls() - callsBefore).toBe(4)
	} finally {
		logged.mockRestore()
	}
})

test('keeps missing V3 factory status for the UI without logging it on each poll', async () => {
	const logged = spyOn(console, 'error').mockImplementation(() => {})
	try {
		const failure: unknown = await discover(clientWithFactory('0x').client).then(
			() => undefined,
			error => error,
		)
		if (!(failure instanceof Error)) throw new Error('Expected discovery to preserve an error for the UI')
		expect(failure.message).toContain('Uniswap V3 factory')
		for (let block = 0; block < 3; block += 1) {
			logMarketDiscoveryFailure('pollFailed=', failure)
			logMarketDiscoveryFailure('report=1 skipped=', failure)
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
		const incompatible: unknown = await discover(clientWithFactory('0x01', { poolResult: 'invalid' }).client).then(
			() => undefined,
			(error: unknown) => error,
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
	await expect(discover(missing.client, 100n)).rejects.toThrow('block 100')
	expect(missing.codeReads).toEqual([[network.factory, '0x64']])
})

test('reports which fee tier failed when pool state is unreadable', async () => {
	const logged = spyOn(console, 'error').mockImplementation(() => {})
	try {
		const pools = new Map<string, PoolState>([[pool500.toLowerCase(), { liquidity: 10n, slot0: 'invalid', tick: 0n, tickCumulatives: [0n, 0n] }]])
		const deployed = clientWithFactory('0x01', { poolResult: fee => (fee === 500 ? pool500 : zeroAddress), pools })
		const discovered = await discover(deployed.client, 100n)
		expect(await poolsForTokens(deployed.client, config, discovered, 100n)).toEqual([])
		expect(logged).toHaveBeenCalledTimes(1)
		const [message] = logged.mock.calls[0] ?? []
		expect(String(message)).toContain('poolFee=500')
		expect(String(message)).toContain('slot0')
	} finally {
		logged.mockRestore()
	}
})
