import type { EntityHistory, LoadOptions, StateCatalog, StateEntity, StateTab } from './browser-types.ts'
import type { CanonicalState } from './canonical-state.ts'
import type { RefreshGate } from './live-update.ts'
import { isCurrentCanonicalGeneration, isCurrentContextRequest, refreshPresentation, runWithForegroundReservation } from './live-update.ts'
import { decodeStateCatalog } from './api-decoding.ts'

interface SystemCatalogLoaderDeps {
	lookup: {
		(selector: '#entity-search'): HTMLInputElement
		(selector: string): HTMLElement
	}
	element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	api: (path: string) => Promise<unknown>
	canonicalState: CanonicalState
	getViewContextVersion: () => number
	getStateData: () => StateCatalog | undefined
	setStateData: (catalog: StateCatalog) => void
	getActiveStateType: () => StateTab
	getSelectedEntityKey: () => string | undefined
	getSelectedEntityHistoryOffset: () => number
	getStateDetailContextVersion: () => number
	requiredChainId: () => string
	stateItems: (catalog: StateCatalog, type: StateTab) => StateEntity[]
	entityCopy: (type: StateTab, item: StateEntity) => [string, string]
	entityKey: (type: StateTab, item: StateEntity) => string
	fetchEntityHistory: (type: StateTab, item: StateEntity, offset: number) => Promise<EntityHistory>
	systemDetailRefreshGate: RefreshGate
	systemStateRefreshGate: RefreshGate
	setSystemControlsDisabled: (disabled: boolean) => void
	renderStateStats: (options?: { live?: boolean }) => void
	renderEntityList: (options?: { refreshSelected?: boolean; live?: boolean; selectedHistory?: EntityHistory; detailGateReserved?: boolean }) => Promise<boolean>
	errorMessage: (error: unknown) => string
	retryCanonicalViewOr: (fallback: () => Promise<boolean>) => Promise<boolean>
}

export const createSystemCatalogLoader = (deps: SystemCatalogLoaderDeps) => {
	const { element, api, canonicalState, requiredChainId, stateItems, entityCopy, entityKey, fetchEntityHistory, systemDetailRefreshGate, systemStateRefreshGate, setSystemControlsDisabled, renderStateStats, renderEntityList, errorMessage, retryCanonicalViewOr } = deps
	const $ = deps.lookup
	let catalogRequestVersion = 0
	const invalidate = () => {
		catalogRequestVersion++
	}
	const performLoadSystemState = async ({ live = false, contextVersion }: LoadOptions = {}): Promise<boolean> => {
		if (contextVersion !== deps.getViewContextVersion()) return false
		const canonicalGeneration = canonicalState.dataGeneration
		const requestVersion = ++catalogRequestVersion
		const alert = $('#system-alert')
		const status = $('#system-status')
		const hadData = deps.getStateData() !== undefined
		const presentation = refreshPresentation({ live })
		if (presentation.loadingState) {
			alert.hidden = true
			alert.replaceChildren()
			status.hidden = false
			status.textContent = hadData ? 'Refreshing registry…' : 'Loading registry…'
		}
		setSystemControlsDisabled(presentation.busy)
		$('#state-stats').setAttribute('aria-busy', String(presentation.busy))
		$('#entity-list').setAttribute('aria-busy', String(presentation.busy))
		try {
			const catalogQuery = new URLSearchParams({ chainId: requiredChainId() })
			const requestedEntityKey = deps.getSelectedEntityKey()
			if (requestedEntityKey !== undefined) {
				catalogQuery.set('selectedType', deps.getActiveStateType())
				catalogQuery.set('selectedIdentity', requestedEntityKey.slice(requestedEntityKey.indexOf(':') + 1))
			}
			const nextStateData = decodeStateCatalog(await api(`/api/v1/state/catalog?${catalogQuery}`))
			if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, catalogRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
			for (const poolItem of nextStateData.pools) poolItem.current_state = {}
			const orderedPoolStates = (nextStateData.poolStates ?? []).toSorted((left, right) => Number(left.block_number) - Number(right.block_number) || Number(left.log_index) - Number(right.log_index))
			for (const state of orderedPoolStates) {
				const poolItem = nextStateData.pools.find(candidate => String(candidate.chain_id) === String(state.chain_id) && candidate.pool_address === state.pool_address)
				if (poolItem?.current_state !== undefined) Object.assign(poolItem.current_state, state.state)
			}
			const stagedStateType = deps.getActiveStateType()
			const stagedDetailContext = deps.getStateDetailContextVersion()
			const query = $('#entity-search').value.trim().toLowerCase()
			const visibleItems = stateItems(nextStateData, stagedStateType).filter(item => !query || entityCopy(stagedStateType, item).join(' ').toLowerCase().includes(query))
			const selectedItem = deps.getSelectedEntityKey() === undefined ? visibleItems[0] : visibleItems.find(item => entityKey(stagedStateType, item) === deps.getSelectedEntityKey())
			const stagedSelectedKey = selectedItem === undefined ? undefined : entityKey(stagedStateType, selectedItem)
			const selectedHistory = selectedItem === undefined ? undefined : await fetchEntityHistory(stagedStateType, selectedItem, deps.getSelectedEntityHistoryOffset())
			const currentQuery = $('#entity-search').value.trim().toLowerCase()
			const currentVisibleItems = stateItems(nextStateData, stagedStateType).filter(item => !currentQuery || entityCopy(stagedStateType, item).join(' ').toLowerCase().includes(currentQuery))
			const currentSelectedItem = deps.getSelectedEntityKey() === undefined ? currentVisibleItems[0] : currentVisibleItems.find(item => entityKey(stagedStateType, item) === deps.getSelectedEntityKey())
			const currentSelectedKey = currentSelectedItem === undefined ? undefined : entityKey(stagedStateType, currentSelectedItem)
			if (
				!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, catalogRequestVersion) ||
				!isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration) ||
				stagedDetailContext !== deps.getStateDetailContextVersion() ||
				stagedStateType !== deps.getActiveStateType() ||
				query !== currentQuery ||
				stagedSelectedKey !== currentSelectedKey
			)
				return false
			return await runWithForegroundReservation(systemDetailRefreshGate, async () => {
				const reservedQuery = $('#entity-search').value.trim().toLowerCase()
				const reservedVisibleItems = stateItems(nextStateData, stagedStateType).filter(item => !reservedQuery || entityCopy(stagedStateType, item).join(' ').toLowerCase().includes(reservedQuery))
				const reservedSelectedItem = deps.getSelectedEntityKey() === undefined ? reservedVisibleItems[0] : reservedVisibleItems.find(item => entityKey(stagedStateType, item) === deps.getSelectedEntityKey())
				const reservedSelectedKey = reservedSelectedItem === undefined ? undefined : entityKey(stagedStateType, reservedSelectedItem)
				if (
					!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, catalogRequestVersion) ||
					!isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration) ||
					stagedDetailContext !== deps.getStateDetailContextVersion() ||
					stagedStateType !== deps.getActiveStateType() ||
					query !== reservedQuery ||
					stagedSelectedKey !== reservedSelectedKey
				)
					return false
				const renderScrollY = window.scrollY
				deps.setStateData(nextStateData)
				renderStateStats({ live })
				const detailRefreshed = await renderEntityList({ refreshSelected: true, live, selectedHistory, detailGateReserved: true })
				if (live) window.scrollTo({ top: renderScrollY, behavior: 'instant' })
				if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, catalogRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
				status.hidden = true
				alert.hidden = true
				alert.replaceChildren()
				const truncated = Object.entries(nextStateData.truncated ?? {})
					.filter(([, value]) => value)
					.map(([name]) => name)
				if (truncated.length > 0 && location.pathname === '/system') {
					alert.hidden = false
					alert.append(element('span', '', 'Large registry: this list may omit entities. Use search to open a specific entity.'))
				}
				return detailRefreshed
			})
		} catch (error) {
			if (isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, catalogRequestVersion) && isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) {
				$('#state-stats').setAttribute('aria-busy', 'false')
				$('#entity-list').setAttribute('aria-busy', 'false')
				$('#state-detail').setAttribute('aria-busy', 'false')
				alert.hidden = false
				alert.replaceChildren()
				status.hidden = true
				alert.append(element('span', '', hadData ? `Refresh failed; showing last known state: ${errorMessage(error)}` : `System state unavailable: ${errorMessage(error)}`))
				const retry = element('button', '', 'Retry')
				retry.type = 'button'
				retry.addEventListener('click', () => retryCanonicalViewOr(loadSystemState))
				alert.append(retry)
				if (!hadData) {
					$('#entity-list-title').textContent = 'Registry unavailable'
					$('#entity-count').textContent = '—'
					$('#entity-list').replaceChildren(element('div', 'state-placeholder', 'No registry data is available.'))
					$('#state-detail').replaceChildren(element('div', 'state-placeholder', 'State details are unavailable.'))
				}
			}
			return false
		} finally {
			if (isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, catalogRequestVersion) && isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) {
				$('#state-stats').setAttribute('aria-busy', 'false')
				$('#entity-list').setAttribute('aria-busy', 'false')
				setSystemControlsDisabled(false)
			}
		}
	}

	const loadSystemState = (options: LoadOptions = {}): Promise<boolean> => {
		const contextVersion = deps.getViewContextVersion()
		const operation = () => performLoadSystemState({ ...options, contextVersion })
		return options.live === true ? systemStateRefreshGate.runBackground(operation) : systemStateRefreshGate.runForeground(operation)
	}

	return { loadSystemState, invalidate }
}
