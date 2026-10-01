import { createUniverseExplorer } from '@zoltar/bot-shared/dashboard/universe-explorer'
import { type Configuration, decodeConfiguration, type Snapshot, type Universe } from './api-validation.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { put } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import { createPoolBrowser } from './pool-browser.ts'
import { publicFailure } from './pool-presentation.ts'

type PoolSelectionContext = {
	state: DashboardState
	elements: DashboardElements
	populateConfiguration: (configuration: Configuration) => void
	syncControls: () => void
}

function universeState(universe: Universe) {
	if (universe.poolCount === 0) return 'No security pool yet'
	if (universe.operationalPoolCount > 0) return `${universe.operationalPoolCount.toString()} operational`
	if (universe.forkedPoolCount > 0) return `${universe.forkedPoolCount.toString()} forked`
	return 'Migration / settlement'
}

/** Owns the universe approvals explorer and the pool browser, whose selections save one change at a time. */
export function createPoolSelection({ state, elements, populateConfiguration, syncControls }: PoolSelectionContext) {
	let universeExplorer: ReturnType<typeof createUniverseExplorer> | undefined

	async function saveSupportedPool(address: string, supported: boolean, chainId: number) {
		if (state.pendingPoolMutations > 0 || state.pendingNetworkProfile !== undefined) throw new Error('A pool or network change is pending')
		state.pendingPoolMutations += 1
		syncControls()
		try {
			const configuration = decodeConfiguration(await put('/api/supported-pool', { address, supported, chainId }))
			populateConfiguration(configuration)
		} finally {
			state.pendingPoolMutations -= 1
			syncControls()
			updatePoolBrowser()
		}
	}
	const poolBrowser = createPoolBrowser(elements.poolBrowser, saveSupportedPool)
	new MutationObserver(updatePoolBrowser).observe(document.body, { attributes: true, attributeFilter: ['data-page'] })

	function updatePoolBrowser() {
		const configuration = state.configuration
		const context = {
			chainId: state.pendingNetworkProfile === undefined && configuration?.networkConfigured === true ? configuration.network?.chainId : undefined,
			enabled: document.body.dataset['page'] === 'pools' && state.stateConnected && state.configurationConnected && state.pendingNetworkProfile === undefined && configuration?.networkConfigured === true && state.pendingPoolMutations === 0,
			selected: state.selectedPools,
			approved: state.approvedUniverses,
			monitored: state.snapshot?.pools ?? [],
		}
		poolBrowser?.update(context)
	}

	function renderUniverses(snapshot: Snapshot, disabled?: boolean) {
		universeExplorer ??= createUniverseExplorer(elements.universeRows, {
			savedMessage: 'Universe approvals saved.',
			onChange: async next => {
				const epoch = state.profileRequestEpoch
				try {
					await put('/api/approved-universes', [...next])
					if (epoch === state.profileRequestEpoch) state.approvedUniverses = next
				} catch (error) {
					throw new Error(publicFailure(error, 'Could not save universe approval. Retry this selection.'))
				}
			},
		})
		universeExplorer.update({
			universes: snapshot.universes.map(universe => ({ ...universe, summary: `${universe.poolCount} pools · ${universeState(universe)} · ${universe.selectedPoolCount} selected · ${universe.migratableVaultCount} migratable vaults` })),
			approved: state.approvedUniverses,
			network: snapshot.network ?? '',
			disabled: disabled ?? (state.pendingNetworkProfile !== undefined || state.configuration?.networkConfigured !== true || !state.stateConnected),
		})
	}

	return { updatePoolBrowser, renderUniverses }
}

export type PoolSelection = ReturnType<typeof createPoolSelection>
