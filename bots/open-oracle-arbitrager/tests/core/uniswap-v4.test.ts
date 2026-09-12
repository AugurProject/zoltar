import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { standardV4QuotePlans, v4QuotePlan } from '#core/uniswap-v4'

describe('Uniswap V4 execution configuration', () => {
	test('maps every supported fee to the canonical hookless tick spacing', () => {
		const token = getAddress('0x221657776846890989a759BA2973e427DfF5C9bB')
		expect(standardV4QuotePlans(token, 1n, 1n).map(plan => ({ fee: plan.fee, tickSpacing: plan.sell.poolKey.tickSpacing }))).toEqual([
			{ fee: 100, tickSpacing: 1 },
			{ fee: 500, tickSpacing: 10 },
			{ fee: 3_000, tickSpacing: 60 },
			{ fee: 10_000, tickSpacing: 200 },
		])
	})

	test('builds a native-ETH/token hookless pool quote', () => {
		const token = getAddress('0x221657776846890989a759BA2973e427DfF5C9bB')
		expect(v4QuotePlan(token, 3_000, 7n, 12n).buy).toEqual({
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
		expect(() => v4QuotePlan(getAddress('0x221657776846890989a759BA2973e427DfF5C9bB'), 3_000, 2n ** 127n, 1n)).toThrow('signed pool-delta range')
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
