import { createUniverseExplorer } from '@zoltar/bot-shared/dashboard/universe-explorer'
import { type Configuration, decodeConfiguration, decodeUniverseLookup, type Snapshot } from './api-validation.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { api, put } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import { publicFailure } from './pool-presentation.ts'

type PoolSelectionContext = {
	state: DashboardState
	elements: DashboardElements
	populateConfiguration: (configuration: Configuration) => void
	syncControls: () => void
}

/** Select shared capital by security pool and universe; question addresses are never capital selections. */
export function createPoolSelection({ state, elements, populateConfiguration, syncControls }: PoolSelectionContext) {
	let universeExplorer: ReturnType<typeof createUniverseExplorer> | undefined
	const root = elements.poolBrowser
	root.innerHTML = `<section class="panel"><h2>Managed security pools</h2><p>Select a security pool and universe to monitor shared owner capital. Universe approval and funded-takeover policy are separate settings. Removing a selection preserves monitoring of existing exposure.</p><form id="security-pool-selection-form"><fieldset><label>Security pool address<input name="address" required pattern="0x[0-9a-fA-F]{40}" placeholder="0x…" autocomplete="off"></label><label>Universe ID<input name="universeId" required pattern="0|[1-9][0-9]*" value="0" inputmode="numeric"></label><button type="submit">Add security pool</button></fieldset></form><p role="status" id="security-pool-selection-status"></p><ul id="security-pool-selections"></ul></section>`
	const form = root.querySelector('form')
	const fields = root.querySelector('fieldset')
	const status = root.querySelector('#security-pool-selection-status')
	const list = root.querySelector('#security-pool-selections')
	if (!(form instanceof HTMLFormElement) || fields === null || status === null || list === null) throw new Error('Security pool selection form is incomplete')
	const formElement = form
	const fieldset = fields
	const feedback = status
	const selections = list
	function enabled() {
		return state.stateConnected && state.configurationConnected && state.pendingNetworkProfile === undefined && state.configuration?.networkConfigured === true && state.pendingPoolMutations === 0
	}
	async function save(address: string, universeId: string, supported: boolean) {
		const chainId = state.configuration?.network?.chainId
		if (!enabled() || chainId === undefined) return
		state.pendingPoolMutations += 1
		feedback.textContent = 'Saving security pool selection…'
		syncControls()
		try {
			populateConfiguration(decodeConfiguration(await put('/api/supported-security-pool', { address, universeId, supported, chainId })))
			feedback.textContent = 'Security pool selection saved.'
		} catch (error) {
			feedback.textContent = publicFailure(error, 'Could not save security pool selection. Retry.')
		} finally {
			state.pendingPoolMutations -= 1
			syncControls()
		}
	}
	formElement.addEventListener('submit', event => {
		event.preventDefault()
		const data = new FormData(formElement)
		const address = data.get('address')
		const universeId = data.get('universeId')
		if (typeof address === 'string' && typeof universeId === 'string') void save(address.trim(), universeId.trim(), true)
	})
	let renderedSelections = ''
	function updatePoolBrowser() {
		fieldset.disabled = !enabled()
		const identity = JSON.stringify([enabled(), state.configuration?.selectedSecurityPools])
		if (identity === renderedSelections) return
		renderedSelections = identity
		selections.replaceChildren()
		for (const selection of state.configuration?.selectedSecurityPools ?? []) {
			const item = document.createElement('li')
			const label = document.createElement('span')
			label.textContent = `${selection.address} · universe ${selection.universeId}`
			label.style.overflowWrap = 'anywhere'
			const remove = document.createElement('button')
			remove.type = 'button'
			remove.textContent = 'Stop automation'
			remove.disabled = !enabled()
			remove.addEventListener('click', () => {
				void save(selection.address, selection.universeId, false)
			})
			item.append(label, document.createTextNode(' '), remove)
			selections.append(item)
		}
		if (selections.childElementCount === 0) selections.textContent = 'No security pools selected.'
	}
	function renderUniverses(snapshot: Snapshot, disabled?: boolean) {
		universeExplorer ??= createUniverseExplorer(elements.universeRows, {
			savedMessage: 'Universe approvals saved.',
			lookupUniverse: async universeId => decodeUniverseLookup(await api('/api/universe-lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ universeId }) }, 15_000)).universes,
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
			universes: snapshot.universes.map(universe => ({ ...universe, summary: `${snapshot.securityPools?.filter(securityPool => securityPool.universeId === universe.id).length ?? 0} managed security pool scopes` })),
			approved: state.approvedUniverses,
			network: snapshot.network ?? '',
			disabled: disabled ?? !enabled(),
		})
	}
	return { updatePoolBrowser, renderUniverses }
}

export type PoolSelection = ReturnType<typeof createPoolSelection>
