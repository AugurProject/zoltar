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
	expect(annualFeeText('1000000000000000000')).toBe('0 %')
	expect(annualFeeText('0')).toBe('100 %')
	for (const invalid of [undefined, null, '', 'bad', '-1']) expect(annualFeeMillionths(invalid)).toBeUndefined()
})

test('derives pool metrics from one tagged snapshot without treating missing values as zero', () => {
	const rows = poolSummaryMetrics({
		currentRetentionRate: String(1000000000000000000n),
		settlementCollateralAttoEth: String(42n * 10n ** 18n),
		currentMintingCapacityAttoEth: String(50n * 10n ** 18n),
		totalPoolHeldAttoRep: String(120n * 10n ** 18n),
		totalUnderwritingLimitAttoEth: String(100n * 10n ** 18n),
		securityMultiplierBps: '25000',
	})
	expect(rows).toContainEqual(['Annual open-interest fee', '0 %'])
	expect(rows).toContainEqual(['Open interest', '42 ETH'])
	expect(rows).toContainEqual(['Minting capacity', '50 ETH'])
	expect(rows).toContainEqual(['Capacity used', '84 %'])
	expect(rows).toContainEqual(['Pool-held REP', '120 REP'])
	expect(rows).toContainEqual(['REP per committed ETH', '1.2 REP/ETH'])
	expect(rows).toContainEqual(['Security multiplier', '2.5 ×'])
	expect(poolSummaryMetrics({}).every(([, value]) => value === 'Unavailable')).toBe(true)
	expect(poolSummaryMetrics({ settlementCollateralAttoEth: String(6n), currentMintingCapacityAttoEth: String(5n) })).toContainEqual(['Capacity used', '120 %'])
	expect(poolSummaryMetrics({ settlementCollateralAttoEth: String(6n), currentMintingCapacityAttoEth: String(0n) })).toContainEqual(['Capacity used', 'Unavailable'])
})

test('renders the production tagged pool snapshot without renaming its fields', async () => {
	const pool = getAddress('0x1111111111111111111111111111111111111111')
	const values: Readonly<Record<string, unknown>> = {
		settlementCollateralAttoEth: 42n * 10n ** 18n,
		totalUnderwritingLimitAttoEth: 100n * 10n ** 18n,
		totalRepBackingUnits: 120n * 10n ** 18n,
		totalClaimableVaultFeesAttoEth: 1n,
		totalAccruedFeesAttoEth: 1n,
		getTotalPoolHeldAttoRep: 120n * 10n ** 18n,
		getCurrentMintingCapacityAttoEth: 50n * 10n ** 18n,
		totalBadDebtAttoEth: 0n,
		systemState: 0n,
		awaitingForkContinuation: false,
		isEscalationResolved: false,
		shareTokenSupplyAttoShares: 1n,
		currentRetentionRate: 10n ** 18n,
		statoblastSecurityMultiplierBps: 25000n,
	}
	const snapshot = await sampleEntityStateWithRead({ entityType: 'pool', entityIdentity: pool, address: pool }, async (_address, _abi, name) => {
		const value = values[name]
		if (value === undefined) throw new Error(`Unexpected pool read ${name}`)
		return value
	})
	expect(snapshot.readStatus).toBe('success')
	if (snapshot.readResult === undefined) throw new Error('Expected tagged pool snapshot')
	expect(poolSummaryMetrics(snapshot.readResult)).toEqual([
		['Annual open-interest fee', '0 %'],
		['Open interest', '42 ETH'],
		['Minting capacity', '50 ETH'],
		['Capacity used', '84 %'],
		['Pool-held REP', '120 REP'],
		['REP per committed ETH', '1.2 REP/ETH'],
		['Security multiplier', '2.5 ×'],
	])
})
