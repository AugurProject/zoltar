/// <reference types='bun-types' />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument as renderWithoutTimestamp } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { SecurityVaultDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { ChainTimestampContext } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { SecurityVaultSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityVaultSection.js'
import { SelectedVaultSummarySection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SelectedVaultSummarySection.js'
import { SelectedPoolRepPriceContext } from '@zoltar/ui-statoblast-shared/features/security-pools/components/RepPriceStatusLabel.js'
import { resolveRepPrice } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/uiPriceOracle.js'
import { evaluateSecurityPoolState } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolState.js'
import type { SecurityVaultSectionProps } from '@zoltar/ui-statoblast-shared/features/types.js'
import { describe, expect, mock, test } from 'bun:test'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'

function createSecurityVaultDetails(overrides: Partial<SecurityVaultDetails> = {}): SecurityVaultDetails {
	return {
		associatedRepPerCapacityBps: 75_000n,
		badDebtAttoEth: 0n,
		currentRetentionRate: 10n,
		disputeStakedAttoRep: 3n * 10n ** 18n,
		managerAddress: zeroAddress,
		minimumVaultRepDepositAttoRep: 10n * 10n ** 18n,
		openInterestAttoEth: 1n * 10n ** 18n,
		poolHeldRepPerCapacityBps: 60_000n,
		totalRepBackingUnits: 1n,
		vaultAttoRepBacking: 12n * 10n ** 18n,
		repToken: zeroAddress,
		underwritingLimitAttoEth: 2n * 10n ** 18n,
		securityPoolAddress: zeroAddress,
		totalUnderwritingLimitAttoEth: 3n * 10n ** 18n,
		claimableFeesAttoEth: 1n * 10n ** 18n,
		universeId: 1n,
		vaultAddress: zeroAddress,
		...overrides,
	}
}

function createSecurityVaultSectionProps(overrides: Partial<SecurityVaultSectionProps> = {}): SecurityVaultSectionProps {
	return {
		accountState: createAccountState(),
		loadingSecurityVault: false,
		onLoadSecurityVault: () => undefined,
		onSecurityVaultFormChange: () => undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		securityPoolVaults: undefined,
		securityVaultDetails: createSecurityVaultDetails(),
		securityVaultError: undefined,
		securityVaultForm: { securityPoolAddress: zeroAddress, selectedVaultOwner: zeroAddress },
		securityVaultMissing: false,
		selectedPoolStatoblastSecurityMultiplierBps: 20_000n,
		...overrides,
	}
}

function renderIntoDocument(component: Parameters<typeof renderWithoutTimestamp>[0]) {
	return renderWithoutTimestamp(<ChainTimestampContext.Provider value={1n}>{component}</ChainTimestampContext.Provider>)
}

function createEndedPoolState() {
	return evaluateSecurityPoolState({
		lifecycleState: 'ended',
		universeHasForked: false,
	})
}

describe('SecurityVaultSection', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('loads the selected vault once per selection and shows nothing for a vault from another pool', async () => {
		const onLoadSecurityVault = mock(() => undefined)
		const otherPool = '0x00000000000000000000000000000000000000a2'
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection {...createSecurityVaultSectionProps({ onLoadSecurityVault, securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: '0x00000000000000000000000000000000000000a1' }), securityVaultForm: { securityPoolAddress: otherPool, selectedVaultOwner: zeroAddress } })} />,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(onLoadSecurityVault).toHaveBeenCalledTimes(1)
		expect(within(document.body).queryByRole('heading', { name: 'My vault' })).toBeNull()
	})

	test('offers the extra vault actions beside the summary', async () => {
		const onAction = mock(() => undefined)
		const renderedComponent = await renderIntoDocument(<SecurityVaultSection {...createSecurityVaultSectionProps({ extraReadinessActions: [{ actionLabel: 'Liquidate vault', description: 'Opens the liquidation form.', key: 'liquidate-vault', onAction, readiness: 'ready' }] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(document.body.querySelector('.vault-detail-layout .vault-detail-actions')).not.toBeNull()
		fireEvent.click(within(document.body).getByRole('button', { name: 'Liquidate vault' }))
		expect(onAction).toHaveBeenCalledTimes(1)
	})

	test('renders the shared selected-vault metric summary', async () => {
		const renderedComponent = await renderIntoDocument(<SecurityVaultSection {...createSecurityVaultSectionProps({ repPerEthPrice: 3n * 10n ** 18n })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const selectedVaultHeading = documentQueries.getByRole('heading', { name: 'My vault' })
		const selectedVaultCard = selectedVaultHeading.closest('.entity-card')
		if (!(selectedVaultCard instanceof HTMLElement)) throw new Error('Expected a selected vault summary card')
		const selectedVaultQueries = within(selectedVaultCard)
		expect(selectedVaultQueries.getByText('Vault REP backing')).not.toBeNull()
		expect(selectedVaultQueries.queryByText('Approved REP')).toBeNull()
		expect(selectedVaultQueries.getByText('Dispute-staked REP')).not.toBeNull()
		expect(selectedVaultQueries.getByText('Associated backing ratio')).not.toBeNull()
		expect(selectedVaultQueries.getByText('2.5×')).not.toBeNull()
		expect(selectedVaultQueries.queryByText('Pool-held REP per committed ETH')).toBeNull()
	})

	test.each([
		{ setting: 'uniswap', quote: 3n * 10n ** 18n, ratio: '2.5×', status: 'via Uniswap' },
		{ setting: 'open-oracle', quote: 3n * 10n ** 18n, ratio: '7.5×', status: 'Stale' },
		{ setting: 'open-oracle-fallback', quote: 3n * 10n ** 18n, ratio: '2.5×', status: 'via Uniswap' },
		{ setting: 'open-oracle-fallback', quote: undefined, ratio: undefined, status: 'No REP price' },
	] as const)('honors $setting for vault health and ratios after the oracle expires ($status)', async ({ setting, quote, ratio, status }) => {
		const repPrice = resolveRepPrice({ now: 10n ** 6n, poolOracle: { price: 10n ** 18n, settlementTimestamp: 1n }, setting, uniswapPrice: quote })
		const renderedComponent = await renderIntoDocument(
			<SelectedPoolRepPriceContext.Provider value={repPrice}>
				<SecurityVaultSection {...createSecurityVaultSectionProps({ repPerEthPrice: repPrice.price })} />
			</SelectedPoolRepPriceContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(document.body.querySelector('.vault-health-status .rep-price-status-title')?.textContent).toBe(status)
		expect(document.body.querySelector('.vault-health')?.textContent).toBe(ratio === undefined ? 'Health unavailable' : 'Healthy')
		if (ratio === undefined) expect(within(document.body).queryByText('Associated backing ratio')).toBeNull()
		else expect(within(document.body).getByText(ratio)).not.toBeNull()
	})

	test('uses the selected UI price for backing ratios and the near-minimum warning', async () => {
		const renderedComponent = await renderIntoDocument(
			<SelectedVaultSummarySection
				repPerEthPrice={3n * 10n ** 18n}
				repPerEthSource='v3'
				repPerEthSourceUrl={undefined}
				underwritingLimitAttoEth={2n * 10n ** 18n}
				currentVaultIsHealthy
				securityVaultDetails={createSecurityVaultDetails({ associatedRepPerCapacityBps: 20_500n })}
				selectedPoolStatoblastSecurityMultiplierBps={20_000n}
				selectedVaultIsOwnedByAccount
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(within(document.body).getByText('2.5×')).not.toBeNull()
		expect(within(document.body).queryByText('2.05×')).toBeNull()
		expect(within(document.body).queryByText('Near minimum')).toBeNull()
	})

	test('colors associated REP per capacity green when the vault remains comfortably above the security multiplier', async () => {
		const renderedComponent = await renderIntoDocument(
			<SelectedVaultSummarySection
				repPerEthPrice={10n ** 18n}
				repPerEthSource={undefined}
				repPerEthSourceUrl={undefined}
				underwritingLimitAttoEth={2n * 10n ** 18n}
				currentVaultIsHealthy
				securityVaultDetails={createSecurityVaultDetails()}
				selectedPoolStatoblastSecurityMultiplierBps={20_000n}
				selectedVaultIsOwnedByAccount
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricValue = within(document.body).getByText('7.5×').closest('.metric-field-value')
		expect(metricValue?.className).toContain('metric-value-success')
		expect(within(document.body).getByText('Healthy')).not.toBeNull()
	})

	test('colors associated REP per capacity yellow when the vault is near the security multiplier', async () => {
		const renderedComponent = await renderIntoDocument(
			<SelectedVaultSummarySection
				repPerEthPrice={10n ** 18n}
				repPerEthSource={undefined}
				repPerEthSourceUrl={undefined}
				underwritingLimitAttoEth={2n * 10n ** 18n}
				currentVaultIsHealthy
				securityVaultDetails={createSecurityVaultDetails({ disputeStakedAttoRep: 0n, vaultAttoRepBacking: 41n * 10n ** 17n })}
				selectedPoolStatoblastSecurityMultiplierBps={20_000n}
				selectedVaultIsOwnedByAccount
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricValue = within(document.body).getByText('2.05×').closest('.metric-field-value')
		expect(metricValue?.className).toContain('metric-value-warning')
		expect(within(document.body).getByText('Near minimum')).not.toBeNull()
	})

	test('colors associated REP per capacity red when the current vault health is underwater', async () => {
		const renderedComponent = await renderIntoDocument(
			<SelectedVaultSummarySection
				repPerEthPrice={10n ** 18n}
				repPerEthSource={undefined}
				repPerEthSourceUrl={undefined}
				underwritingLimitAttoEth={2n * 10n ** 18n}
				currentVaultIsHealthy={false}
				securityVaultDetails={createSecurityVaultDetails()}
				selectedPoolStatoblastSecurityMultiplierBps={20_000n}
				selectedVaultIsOwnedByAccount
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricValue = within(document.body).getByText('7.5×').closest('.metric-field-value')
		expect(metricValue?.className).toContain('metric-value-danger')
		expect(within(document.body).getByText('Underwater')).not.toBeNull()
	})

	test('does not infer vault health text from associated REP per capacity when current health is unavailable', async () => {
		const renderedComponent = await renderIntoDocument(
			<SelectedVaultSummarySection
				repPerEthPrice={undefined}
				repPerEthSource={undefined}
				repPerEthSourceUrl={undefined}
				underwritingLimitAttoEth={2n * 10n ** 18n}
				currentVaultIsHealthy={undefined}
				securityVaultDetails={createSecurityVaultDetails({ associatedRepPerCapacityBps: 19_000n })}
				selectedPoolStatoblastSecurityMultiplierBps={20_000n}
				selectedVaultIsOwnedByAccount
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).queryByText('1.9×')).toBeNull()
		expect(within(document.body).getByText('Health unavailable')).not.toBeNull()
		expect(within(document.body).queryByText('Healthy')).toBeNull()
		expect(within(document.body).queryByText('Near minimum')).toBeNull()
		expect(within(document.body).queryByText('Underwater')).toBeNull()
	})

	test('hides the vault health and its price source once the pool has ended', async () => {
		const renderVault = async (poolState: ReturnType<typeof createEndedPoolState> | undefined) =>
			await renderIntoDocument(
				<SecurityVaultSection
					{...createSecurityVaultSectionProps({
						poolState,
						repPerEthPrice: 3n * 10n ** 18n,
						securityVaultDetails: createSecurityVaultDetails({ disputeStakedAttoRep: 0n }),
					})}
				/>,
			)
		const operational = await renderVault(undefined)
		expect(document.body.querySelector('.vault-health-status')).not.toBeNull()
		operational.cleanup()
		cleanupRenderedComponent = (await renderVault(createEndedPoolState())).cleanup
		// After resolution liquidation is closed, so a health verdict priced from an expired oracle is only noise.
		expect(document.body.querySelector('.vault-health-status')).toBeNull()
		expect(within(document.body).queryByText('Healthy')).toBeNull()
	})
})
