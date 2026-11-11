import { expect, test } from 'bun:test'
import { canonicalMarketPriceAllowsExecution, marketPriceAllowsExecution } from '../../src/core/candidate-selection.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { portfolioSettings, unit } from '../support/portfolio-observation.ts'

test('report sponsorship cannot inherit the ordinary execution opt-out from independent price evidence', async () => {
	const settings = portfolioSettings()
	settings.centralizedMarkets.requiredForExecution = false
	const state = initialRuntimeState(false, undefined, 1)
	const candidate = { repToken: settings.centralizedMarkets.assetAddress, lastPrice: unit }
	expect(marketPriceAllowsExecution(candidate, settings, state)).toBe(true)
	expect(marketPriceAllowsExecution(candidate, settings, state, true)).toBe(false)
	expect(
		await canonicalMarketPriceAllowsExecution(
			candidate,
			settings,
			state,
			async () => undefined,
			async () => {
				throw new Error('No evidence should reach canonical validation')
			},
			true,
		),
	).toBe(false)
})
