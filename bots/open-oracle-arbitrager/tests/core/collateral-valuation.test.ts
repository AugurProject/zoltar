import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import { attoWethValue, valuationFromSqrtPrice, WETH_VALUATION } from '#core/collateral-valuation'

const weth = getAddress('0x8000000000000000000000000000000000000000')
const below = getAddress('0x0000000000000000000000000000000000000001')
const above = getAddress('0xf000000000000000000000000000000000000000')
const usdcUnit = 10n ** 6n
// 3000 six-decimal collateral per WETH: one whole collateral token is worth 1e18 / 3000 atto-WETH.
const expectedAttoWethPerToken = 10n ** 18n / 3_000n

function sqrt(value: bigint) {
	let root = value
	let next = (root + 1n) / 2n
	while (next < root) {
		root = next
		next = (root + value / root) / 2n
	}
	return root
}

function withinOnePpm(actual: bigint, expected: bigint) {
	const difference = actual > expected ? actual - expected : expected - actual
	return difference * 1_000_000n <= expected
}

describe('#1274: collateral valuation from the collateral/WETH pool price', () => {
	test('values collateral that sorts before WETH, where the pool price is WETH per collateral', () => {
		const valuation = valuationFromSqrtPrice(below, weth, sqrt((2n ** 192n * 10n ** 18n) / (3_000n * usdcUnit)))
		expect(withinOnePpm(attoWethValue(valuation, usdcUnit, 'down'), expectedAttoWethPerToken)).toBeTrue()
	})

	test('values collateral that sorts after WETH, where the pool price is collateral per WETH', () => {
		const valuation = valuationFromSqrtPrice(above, weth, sqrt((2n ** 192n * 3_000n * usdcUnit) / 10n ** 18n))
		expect(withinOnePpm(attoWethValue(valuation, usdcUnit, 'down'), expectedAttoWethPerToken)).toBeTrue()
	})

	test('rounds proceeds toward negative infinity and costs toward positive infinity', () => {
		const third = { attoWeth: 1n, units: 3n }
		expect(attoWethValue(third, 4n, 'down')).toBe(1n)
		expect(attoWethValue(third, 4n, 'up')).toBe(2n)
		expect(attoWethValue(third, -4n, 'down')).toBe(-2n)
		expect(attoWethValue(third, -4n, 'up')).toBe(-1n)
		expect(attoWethValue(WETH_VALUATION, 7n, 'down')).toBe(7n)
		expect(() => valuationFromSqrtPrice(below, weth, 0n)).toThrow('marginal price is unavailable')
	})
})
