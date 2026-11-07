import { expect, test } from 'bun:test'
import { settingsPageMarkup } from '../../src/dashboard/settings-page.tsx'
import { decodeConfiguration } from '../../src/dashboard/api-validation.ts'
import { enabledAutomaticActions } from '../../src/dashboard/strategy-form.ts'
import { serializedSettings } from '../../src/config/settings.ts'
import { portfolioSettings } from '../support/portfolio-observation.ts'

test('settings expose the funded portfolio policy used by execution', () => {
	for (const name of ['allowFundedTakeovers', 'maximumPrincipalRep', 'maximumTotalPrincipalRep', 'maximumCommitmentEth', 'maximumOwnFundingRep', 'minimumNetRewardEth', 'walletReserveEth', 'targetHealthFactorBps']) expect(settingsPageMarkup).toContain(`name="${name}"`)
	for (const name of ['allowAutomaticDeposits', 'allowAutomaticWithdrawals', 'vaultTopUpHealthBps', 'maximumLiquidationDebtEth']) expect(settingsPageMarkup).not.toContain(`name="${name}"`)
})

test('resume consent describes the actual saved portfolio automation switch', () => {
	const settings = portfolioSettings()
	expect(enabledAutomaticActions(decodeConfiguration(serializedSettings(settings)))).toEqual(['funded takeovers', 'earnings claims'])
	settings.portfolioPolicy.allowFundedTakeovers = false
	expect(enabledAutomaticActions(decodeConfiguration(serializedSettings(settings)))).toEqual([])
})
