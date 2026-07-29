import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { STANDARD_UNISWAP_FEES, STANDARD_UNISWAP_V4_POOLS, standardV4QuotePlans, v4QuoteParameters, v4TickSpacing } from './uniswap-v4.js'

describe('Uniswap V4 execution configuration', () => {
	test('maps every supported fee to the canonical hookless tick spacing', () => {
		expect(STANDARD_UNISWAP_V4_POOLS).toEqual([
			{ fee: 100, tickSpacing: 1 },
			{ fee: 500, tickSpacing: 10 },
			{ fee: 3_000, tickSpacing: 60 },
			{ fee: 10_000, tickSpacing: 200 },
		])
		expect(STANDARD_UNISWAP_FEES.map(fee => [fee, v4TickSpacing(fee)])).toEqual([
			[100, 1],
			[500, 10],
			[3_000, 60],
			[10_000, 200],
		])
	})

	test('builds a native-ETH/token hookless pool quote', () => {
		const token = getAddress('0x221657776846890989a759BA2973e427DfF5C9bB')
		expect(v4QuoteParameters(token, 3_000, 12n, true)).toEqual({
			exactAmount: 12n,
			hookData: '0x',
			poolKey: {
				currency0: zeroAddress,
				currency1: token,
				fee: 3_000,
				hooks: zeroAddress,
				tickSpacing: 60,
			},
			zeroForOne: true,
		})
	})

	test('rejects amounts that cannot be represented by a signed V4 pool delta', () => {
		expect(() => v4QuoteParameters(getAddress('0x221657776846890989a759BA2973e427DfF5C9bB'), 3_000, 2n ** 127n, false)).toThrow('signed pool-delta range')
	})

	test('builds independent buy and sell quotes for every supported standard pool', () => {
		const token = getAddress('0x221657776846890989a759BA2973e427DfF5C9bB')
		const plans = standardV4QuotePlans(token, 11n, 13n)
		expect(plans.map(plan => plan.fee)).toEqual([100, 500, 3_000, 10_000])
		expect(plans.map(plan => plan.sell.exactAmount)).toEqual([11n, 11n, 11n, 11n])
		expect(plans.map(plan => plan.buy.exactAmount)).toEqual([13n, 13n, 13n, 13n])
		expect(plans.map(plan => [plan.sell.zeroForOne, plan.buy.zeroForOne])).toEqual([
			[false, true],
			[false, true],
			[false, true],
			[false, true],
		])
	})
})
