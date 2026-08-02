import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Address } from '#ethereum'
import {
	appendPriceHistory,
	availableTokenBalances,
	childPayouts,
	constantProductSpotPriceWeth,
	createTokenCatalogTracker,
	formatTokenAmount,
	loadPriceHistory,
	MAX_OBSERVED_MONITORING_TOKENS,
	missingPricePoints,
	payoutDistributionHash,
	poolSpotPriceWeth,
	pricePoints,
	tokenCatalogForScan,
	type TokenMarketSnapshot,
} from '#monitoring/market-monitor'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

describe('Augur REP discovery helpers', () => {
	test('derives one complete payout vector per outcome', () => {
		expect(childPayouts(1_000n, 3n)).toEqual([
			[1_000n, 0n, 0n],
			[0n, 1_000n, 0n],
			[0n, 0n, 1_000n],
		])
	})

	test('matches the deployed REPv2 fork payout hashes', () => {
		expect(payoutDistributionHash([0n, 1_000n, 0n])).toBe('0x544cbfd6b85821f7bbff5de4b999b0b4b701354a3f2d0c4707fd0358295b0173')
		expect(payoutDistributionHash([0n, 0n, 1_000n])).toBe('0x99c9250f58203a3183137eae3a39da9d9d956cd08d1707a58cff5cddf957afe5')
	})

	test('keeps discovery inputs separate and revokes a configured non-REP token without restarting', async () => {
		const rep = '0x0000000000000000000000000000000000000001' as Address
		const configured = '0x0000000000000000000000000000000000000002' as Address
		const observed = '0x0000000000000000000000000000000000000003' as Address
		const forkRep = '0x0000000000000000000000000000000000000004' as Address
		const discoveryCalls: { configured: readonly Address[]; observed: readonly Address[] }[] = []
		const catalogForScan = createTokenCatalogTracker((discoveryConfigured, discoveryObserved) => {
			discoveryCalls.push({ configured: discoveryConfigured, observed: discoveryObserved })
			return Promise.resolve(discoveryCalls.length === 1 ? [rep, ...discoveryConfigured, ...discoveryObserved] : [rep, forkRep, ...discoveryConfigured, ...discoveryObserved])
		})

		expect(await catalogForScan([configured], [observed])).toEqual({
			executionTokens: [rep, configured],
			monitoringTokens: [rep, configured, observed],
		})
		expect(await catalogForScan([], [configured, observed])).toEqual({
			executionTokens: [rep, forkRep],
			monitoringTokens: [rep, forkRep, configured, observed],
		})
		expect(discoveryCalls).toEqual([
			{ configured: [], observed: [] },
			{ configured: [], observed: [] },
		])
	})

	test('prioritizes every execution token and caps permissionless observed monitoring work', () => {
		const execution = Array.from({ length: 3 }, (_, index) => `0x${(index + 1).toString(16).padStart(40, '0')}` as Address)
		const observed = Array.from({ length: MAX_OBSERVED_MONITORING_TOKENS + 500 }, (_, index) => `0x${(index + 100).toString(16).padStart(40, '0')}` as Address)
		const catalog = tokenCatalogForScan(execution.slice(0, 1), execution.slice(1), observed)
		expect(catalog.executionTokens).toEqual(execution)
		expect(catalog.monitoringTokens.slice(0, execution.length)).toEqual(execution)
		expect(catalog.monitoringTokens).toHaveLength(execution.length + MAX_OBSERVED_MONITORING_TOKENS)
	})
})

test('formats arbitrary token contribution units using token metadata decimals', () => {
	expect(formatTokenAmount(12_345_678n, 6)).toBe('12.345678')
	expect(formatTokenAmount(12_345_678n, 18)).toBe('0.000000000012345678')
})

test('isolates a reverting token balance without dropping healthy inventory', async () => {
	const healthy = '0x0000000000000000000000000000000000000001' as Address
	const reverting = '0x0000000000000000000000000000000000000002' as Address
	const balances = await availableTokenBalances([healthy, reverting], token => (token === healthy ? Promise.resolve(42n) : Promise.reject(new Error('balanceOf reverted'))))
	expect(balances).toEqual(new Map([[healthy.toLowerCase(), 42n]]))
})

test('normalizes Uniswap spot prices for both token orderings', () => {
	const lower = '0x0000000000000000000000000000000000000001' as Address
	const higher = '0x0000000000000000000000000000000000000002' as Address
	const doubleSqrtPrice = 2n * 2n ** 96n
	expect(poolSpotPriceWeth(doubleSqrtPrice, lower, higher, 18)).toBe('4')
	expect(poolSpotPriceWeth(doubleSqrtPrice, higher, lower, 18)).toBe('0.25')
	expect(constantProductSpotPriceWeth(2n * 10n ** 18n, 1n * 10n ** 18n, 18)).toBe('0.5')
})

test('persists per-pool price history across restarts', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-market-history-'))
	temporaryDirectories.push(directory)
	const path = join(directory, 'prices.jsonl')
	const address = '0x0000000000000000000000000000000000000001' as Address
	const pool = '0x0000000000000000000000000000000000000002' as Address
	const markets: TokenMarketSnapshot[] = [
		{
			address,
			balance: undefined,
			decimals: 18,
			name: 'Reputation',
			pools: [{ address: pool, fee: 3_000, liquidity: '100', priceWeth: '0.0042', url: 'https://etherscan.io/address/pool', venue: 'Uniswap V3' }],
			symbol: 'REPv2',
		},
	]
	const points = pricePoints(markets, 123n, '2026-07-25T00:00:00.000Z')
	await appendPriceHistory(path, points)
	expect(await loadPriceHistory(path)).toEqual(points)
})

test('loads valid price history around truncated and structurally invalid records', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-market-history-'))
	temporaryDirectories.push(directory)
	const path = join(directory, 'prices.jsonl')
	const valid = {
		blockNumber: '123',
		pool: '0x0000000000000000000000000000000000000002' as Address,
		priceWeth: '0.0042',
		sampledAt: '2026-07-25T00:00:00.000Z',
		symbol: 'REPv2',
		token: '0x0000000000000000000000000000000000000001' as Address,
		venue: 'Uniswap V3 0.3%',
	}
	await writeFile(path, `${JSON.stringify(valid)}\n{"blockNumber":"124"\n${JSON.stringify({ ...valid, blockNumber: -1 })}\n${JSON.stringify(valid)}\n`, 'utf8')
	expect(await loadPriceHistory(path)).toEqual([valid, valid])
})

test('compacts price history after it crosses the storage bound', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-market-history-'))
	temporaryDirectories.push(directory)
	const path = join(directory, 'prices.jsonl')
	const template = {
		pool: '0x0000000000000000000000000000000000000002' as Address,
		priceWeth: '0.0042',
		sampledAt: '2026-07-25T00:00:00.000Z',
		symbol: 'REPv2',
		token: '0x0000000000000000000000000000000000000001' as Address,
		venue: 'Uniswap V3 0.3%',
	}
	const points = Array.from({ length: 5 }, (_, index) => ({ ...template, blockNumber: index.toString() }))
	await appendPriceHistory(path, points, { maximumBytes: 600, maximumRecords: 2 })
	expect(await loadPriceHistory(path, 10)).toEqual(points.slice(-2))
	expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(2)
})

test('records every priced venue at a new head and excludes pools without a usable spot price', () => {
	const token = '0x0000000000000000000000000000000000000001' as Address
	const v3Pool = '0x0000000000000000000000000000000000000002' as Address
	const v2Pool = '0x0000000000000000000000000000000000000003' as Address
	const emptyPool = '0x0000000000000000000000000000000000000004' as Address
	const markets: TokenMarketSnapshot[] = [
		{
			address: token,
			balance: undefined,
			decimals: 6,
			name: 'Test Token',
			pools: [
				{ address: v3Pool, fee: 500, liquidity: '10', priceWeth: '0.1', url: 'https://example.test/v3', venue: 'Uniswap V3' },
				{ address: v2Pool, fee: 3_000, liquidity: '20 token / 2 WETH', priceWeth: '0.2', url: 'https://example.test/v2', venue: 'Uniswap V2' },
				{ address: emptyPool, fee: 3_000, liquidity: '0 token / 0 WETH', priceWeth: undefined, url: 'https://example.test/empty', venue: 'SushiSwap V2' },
			],
			symbol: 'TEST',
		},
	]

	const points = pricePoints(markets, 456n, '2026-07-25T00:00:12.000Z')
	expect(points).toEqual([
		{ blockNumber: '456', pool: v3Pool, priceWeth: '0.1', sampledAt: '2026-07-25T00:00:12.000Z', symbol: 'TEST', token, venue: 'Uniswap V3 0.05%' },
		{ blockNumber: '456', pool: v2Pool, priceWeth: '0.2', sampledAt: '2026-07-25T00:00:12.000Z', symbol: 'TEST', token, venue: 'Uniswap V2 0.3%' },
	])
	const [firstPoint, secondPoint] = points
	if (firstPoint === undefined || secondPoint === undefined) throw new Error('Expected both priced pools')
	expect(missingPricePoints([firstPoint], points)).toEqual([secondPoint])
})
