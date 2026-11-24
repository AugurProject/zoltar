import { expect, test } from 'bun:test'

type Scenario = {
	ownRep: number
	maximumBonusRep: number
	repPriceAtExitEth: number
	repPriceNowEth: number
	incrementalPrincipalLossFraction: number
	annualAlternativeReturn: number
	lockDays: number
	annualFeeIncomeEth: number
	demandFraction: number
	gasEth: number
}

// #1562. Scenario model for a fixed-size fill, with a linearly growing bonus.
// The loss input measures downside relative to the receiver's alternative use of capital.
const evaluate = (scenario: Scenario) => {
	const years = scenario.lockDays / 365
	const ownPrincipal = scenario.ownRep * scenario.repPriceNowEth
	const fees = scenario.annualFeeIncomeEth * scenario.demandFraction * years
	const capitalCost = ownPrincipal * (scenario.annualAlternativeReturn * years + scenario.incrementalPrincipalLossFraction)
	const requiredBonusValue = Math.max(0, scenario.gasEth + capitalCost - fees)
	const maximumBonusValue = (scenario.maximumBonusRep * scenario.repPriceAtExitEth) / (1 + scenario.annualAlternativeReturn * years)
	const breakEvenFraction = requiredBonusValue === 0 ? 0 : requiredBonusValue / maximumBonusValue
	return {
		netAtMaximumBonusEth: maximumBonusValue + fees - scenario.gasEth - capitalCost,
		earliestBreakEvenMinutes: breakEvenFraction <= 1 ? breakEvenFraction * 60 : undefined,
	}
}

const ordinary: Scenario = {
	ownRep: 100,
	maximumBonusRep: 20,
	repPriceNowEth: 0.01,
	repPriceAtExitEth: 0.01,
	incrementalPrincipalLossFraction: 0,
	annualAlternativeReturn: 0.1,
	lockDays: 36.5,
	annualFeeIncomeEth: 0.2,
	demandFraction: 1,
	gasEth: 0.03,
}

test('a funded receiver can break even before the maximum bonus under stable conditions', () => {
	const result = evaluate(ordinary)
	expect(result.earliestBreakEvenMinutes).toBeCloseTo(6.06, 4)
	expect(result.netAtMaximumBonusEth).toBeCloseTo(0.1780198, 6)
})

test('a demand drop, REP loss and delayed exit can prevent a profitable fill even at the maximum bonus', () => {
	const result = evaluate({
		...ordinary,
		repPriceAtExitEth: 0.005,
		incrementalPrincipalLossFraction: 0.5,
		lockDays: 182.5,
		demandFraction: 0.2,
		gasEth: 0.08,
	})
	expect(result.earliestBreakEvenMinutes).toBeUndefined()
	expect(result.netAtMaximumBonusEth).toBeCloseTo(-0.5147619, 6)
})

test('a receiver can break even immediately when fees cover gas and the alternative return', () => {
	expect(evaluate({ ...ordinary, maximumBonusRep: 0, gasEth: 0.01 }).earliestBreakEvenMinutes).toBe(0)
})

test('at the same capital and fee terms the vault bonus can cover a shortfall ordinary provision cannot', () => {
	const withoutBonus = evaluate({ ...ordinary, maximumBonusRep: 0 })
	expect(withoutBonus.netAtMaximumBonusEth).toBeCloseTo(-0.02, 6)
	expect(withoutBonus.earliestBreakEvenMinutes).toBeUndefined()
	expect(evaluate(ordinary).earliestBreakEvenMinutes).toBeLessThan(60)
})
