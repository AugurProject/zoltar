import { getAddress } from '../../src/ethereum.ts'
import { sampleEntityStateWithRead } from '../../src/snapshots.ts'
import { expect, test } from 'bun:test'
import { annualFeeMillionths, annualFeeText, poolSummaryMetrics } from '../../browser/pool-metrics.ts'

test('matches Statoblast annual fee presentation, including normal limits and no decay', () => {
	// Statoblast shows the same values: the origin-pool default retention rate is 9.462085 % a year.
	const expected: ReadonlyArray<readonly [bigint, string]> = [
		[0n, '100000000'],
		[1n, '100000000'],
		[999999977880000000n, '50220968'],
		[999999987000000000n, '33632851'],
		[999999996848000000n, '9462085'],
		[999999999999999999n, '0'],
		[1000000000000000000n, '0'],
	]
	for (const [rate, millionths] of expected) expect(annualFeeMillionths(rate)).toBe(millionths)
	expect(annualFeeText('1000000000000000000')).toBe('0%')
	expect(annualFeeText('0')).toBe('100%')
	for (const invalid of [undefined, null, '', 'bad', '-1']) expect(annualFeeMillionths(invalid)).toBeUndefined()
})

test('derives question settlement metrics without presenting shared REP as question-owned capital', () => {
	const rows = poolSummaryMetrics({
		collateral: { symbol: 'ETH', decimals: 18 },
		questionSettlementAttoEth: String(42n * 10n ** 18n),
		averageValueAttoEthPerShare: String(7n * 10n ** 17n),
		shareTokenSupplyAttoShares: String(60n * 10n ** 18n),
		securityMultiplierBps: '25000',
	})
	expect(rows).toEqual([
		['Question settlement value', '42 ETH'],
		['Average value per share', '0.7 ETH'],
		['Outcome share supply', '60 shares'],
		['Question escalation multiplier', '2.5 ×'],
	])
	expect(poolSummaryMetrics({}).every(([, value]) => value === 'Unavailable')).toBe(true)
	expect(poolSummaryMetrics({ collateral: { symbol: 'ETH', decimals: 18 }, questionSettlementAttoEth: 0n.toString() })).toContainEqual(['Question settlement value', '0 ETH'])
})

test('samples the current question ledger ABI and live settlement quotes without retired vault reads', async () => {
	const pool = getAddress('0x1111111111111111111111111111111111111111')
	const values: Readonly<Record<string, unknown>> = {
		securityPoolFactory: pool,
		getSecurityPoolPortfolio: pool,
		collateralToken: pool,
		symbol: 'WETH',
		decimals: 18n,
		settlementCollateralAttoEth: 43n * 10n ** 18n,
		systemState: 0n,
		awaitingForkContinuation: false,
		isEscalationResolved: false,
		shareTokenSupplyAttoShares: 60n * 10n ** 18n,
		statoblastSecurityMultiplierBps: 25000n,
	}
	const snapshot = await sampleEntityStateWithRead({ entityType: 'pool', entityIdentity: pool, address: pool }, async (address, abi, name, args) => {
		expect(address).toBe(pool)
		expect(abi.some(entry => entry.type === 'function' && entry.name === name)).toBe(true)
		if (name === 'attoSharesToAttoEth') {
			if (args?.[0] === 60n * 10n ** 18n) return 42n * 10n ** 18n
			throw new Error('Unexpected quote amount')
		}
		const value = values[name]
		if (value === undefined) throw new Error(`Unexpected question read ${name}`)
		return value
	})
	expect(snapshot.readStatus).toBe('success')
	if (snapshot.readResult === undefined) throw new Error('Expected tagged question snapshot')
	expect(snapshot.readResult['questionSettlementAttoEth']).toBe(String(42n * 10n ** 18n))
	expect(poolSummaryMetrics({ ...snapshot.readResult, collateral: { symbol: 'ETH', decimals: 18 } })).toEqual([
		['Question settlement value', '42 ETH'],
		['Average value per share', '0.7 ETH'],
		['Outcome share supply', '60 shares'],
		['Question escalation multiplier', '2.5 ×'],
	])
})

for (const supply of [0n, 1n]) {
	test(`question quote stays within the remaining supply of ${supply}`, async () => {
		const pool = getAddress('0x1111111111111111111111111111111111111111')
		const snapshot = await sampleEntityStateWithRead({ entityType: 'pool', entityIdentity: pool, address: pool }, async (_address, _abi, name, args) => {
			if (['securityPoolFactory', 'getSecurityPoolPortfolio', 'collateralToken'].includes(name)) return pool
			if (name === 'symbol') return 'WETH'
			if (name === 'decimals') return 18n
			if (name === 'shareTokenSupplyAttoShares') return supply
			if (name === 'attoSharesToAttoEth') {
				expect(args).toEqual([supply])
				return supply
			}
			if (name === 'awaitingForkContinuation' || name === 'isEscalationResolved') return false
			return 0n
		})
		expect(snapshot.readStatus).toBe('success')
		expect(snapshot.readResult?.['averageValueAttoEthPerShare']).toBe(supply === 0n ? '0' : String(10n ** 18n))
	})
}
