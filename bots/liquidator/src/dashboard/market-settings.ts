import { confirmOperatorAction, reviewChangeRows } from '@zoltar/bot-shared/dashboard/confirmation'
import { formIsSubmitting, setFormSubmitting } from '@zoltar/bot-shared/dashboard/form-state'
import { type Configuration, decodeConfiguration, decodeMarketProbe } from './api-validation.ts'
import type { MutationControls } from './dashboard-controls.ts'
import type { ConfigurationSource } from './dashboard-configuration.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { actionStatus, put } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import { readMarketConfiguration, reviewableRootMarket } from './market-configuration-editor.tsx'
import { renderMarketSources } from './market-source-panel.tsx'
import { publicFailure } from './pool-presentation.ts'

type MarketSettingsContext = {
	state: DashboardState
	elements: DashboardElements
	controls: MutationControls
	populateConfiguration: (configuration: Configuration, source?: ConfigurationSource) => void
}

/** Returns the market-source table to the configured source admission instead of the latest probe. */
function showConfiguredAdmission(state: DashboardState, elements: DashboardElements) {
	state.marketSourceProbeRows = undefined
	elements.marketSourceCaption.textContent = 'Configured source admission'
	elements.showActiveAdmissionButton.classList.add('hidden')
}

/** Drops a market-source probe and empties the table, as when the dashboard leaves the probed chain profile. */
export function clearMarketSourceProbe(state: DashboardState, elements: DashboardElements) {
	showConfiguredAdmission(state, elements)
	actionStatus(elements.marketSourceTestStatus, '')
	renderMarketSources([])
}

/** Wires the market configuration form and the source probe, whose rows replace the configured admission until dismissed. */
export function registerMarketSettings({ state, elements, controls, populateConfiguration }: MarketSettingsContext) {
	const { marketConfigurationSaveStatus, marketSourceTestStatus, testMarketSourcesButton } = elements

	elements.marketConfigurationForm.addEventListener('submit', async event => {
		event.preventDefault()
		if (formIsSubmitting('market-configuration-form')) return
		// The submitting latch keeps the form locked across polls through the review and the request.
		setFormSubmitting('market-configuration-form', true)
		actionStatus(marketConfigurationSaveStatus, 'Validating…')
		try {
			const value = readMarketConfiguration()
			const saved = state.configuration
			if (
				!(await confirmOperatorAction({
					title: 'Review market and pool changes',
					description: 'Market sources and desired pools can change which assets the bot funds on the next scan.',
					confirmLabel: 'Save markets',
					changes: reviewChangeRows({ root: reviewableRootMarket(saved?.centralizedMarkets), children: saved?.childMarketConfigurations, desiredPools: saved?.desiredPools }, value),
				}))
			) {
				actionStatus(marketConfigurationSaveStatus, '')
				return
			}
			actionStatus(marketConfigurationSaveStatus, 'Saving…')
			const configuration = decodeConfiguration(await put('/api/market-configuration', value))
			showConfiguredAdmission(state, elements)
			actionStatus(marketSourceTestStatus, '')
			populateConfiguration(configuration, 'market-configuration-form')
			actionStatus(marketConfigurationSaveStatus, 'Saved; changes apply on the next scan')
		} catch (error) {
			actionStatus(marketConfigurationSaveStatus, publicFailure(error, 'Could not save market configuration. Review the fields and retry.'), true)
		} finally {
			setFormSubmitting('market-configuration-form', false)
			controls.syncControls()
		}
	})

	testMarketSourcesButton.addEventListener('click', async () => {
		if (state.marketSourceProbePending) return
		const requestEpoch = state.profileRequestEpoch
		// The pending latch keeps the button locked across polls so one click starts one probe.
		state.marketSourceProbePending = true
		testMarketSourcesButton.disabled = true
		actionStatus(marketSourceTestStatus, 'Testing saved CEX and DEX sources…')
		try {
			const result = decodeMarketProbe(await put('/api/test-market-sources', {}))
			if (requestEpoch !== state.profileRequestEpoch) return
			const rows = result.assets.flatMap(asset =>
				asset.sources.map(source => ({
					...source,
					assetId: asset.assetId,
					status: source.status,
				})),
			)
			state.marketSourceProbeRows = rows
			elements.marketSourceCaption.textContent = 'Latest source probe (not admission)'
			elements.showActiveAdmissionButton.classList.remove('hidden')
			renderMarketSources(rows)
			actionStatus(marketSourceTestStatus, `Source test completed at block ${result.blockNumber}`)
		} catch (error) {
			if (requestEpoch !== state.profileRequestEpoch) return
			showConfiguredAdmission(state, elements)
			if (state.snapshot !== undefined) renderMarketSources(state.snapshot.marketSources)
			actionStatus(marketSourceTestStatus, publicFailure(error, 'Could not test saved market sources. Check the bot logs and retry.'), true)
		} finally {
			state.marketSourceProbePending = false
			controls.syncControls()
		}
	})

	elements.showActiveAdmissionButton.addEventListener('click', () => {
		showConfiguredAdmission(state, elements)
		actionStatus(marketSourceTestStatus, 'Showing active admission from persisted consensus evidence')
		if (state.snapshot !== undefined) renderMarketSources(state.snapshot.marketSources)
	})
}
