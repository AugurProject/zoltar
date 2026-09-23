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
	const { element, api, canonicalState, requiredChainId, stateItems, entityKey, fetchEntityHistory, systemDetailRefreshGate, systemStateRefreshGate, setSystemControlsDisabled, renderStateStats, renderEntityList, errorMessage, retryCanonicalViewOr } = deps
	const $ = deps.lookup
	let catalogRequestVersion = 0
	let pageOffset = 0
	let catalogScope: string | undefined
	let pageBoundaryKeys: Partial<Record<StateTab, string>> = {}
	const catalogTypes = ['pools', 'vaults', 'questions', 'universes'] as const
	const pageBoundaries = (page: StateCatalog, previous: Partial<Record<StateTab, string>> = {}): Partial<Record<StateTab, string>> => {
		const boundaries = { ...previous }
		for (const type of catalogTypes) {
			const items = stateItems(page, type)
			const lastItem = items[Math.min(items.length, page.limit ?? 500) - 1]
			if (lastItem !== undefined) boundaries[type] = entityKey(type, lastItem)
		}
		return boundaries
	}
	const mergeCatalog = (first: StateCatalog, second: StateCatalog, truncated = second.truncated): StateCatalog => {
		const merge = <T extends StateEntity>(type: StateTab, previous: readonly T[], added: readonly T[]): T[] => {
			const seen = new Set(previous.map(item => entityKey(type, item)))
			return [...previous, ...added.filter(item => !seen.has(entityKey(type, item)))]
		}
		const previousStates = first.poolStates ?? []
		const seenStates = new Set(previousStates.map(item => `${item.chain_id}:${item.pool_address}:${item.event_name}`))
		return {
			...first,
			pools: merge('pools', first.pools, second.pools),
			vaults: merge('vaults', first.vaults, second.vaults),
			questions: merge('questions', first.questions, second.questions),
			universes: merge('universes', first.universes, second.universes),
			poolStates: [...previousStates, ...(second.poolStates ?? []).filter(item => !seenStates.has(`${item.chain_id}:${item.pool_address}:${item.event_name}`))],
			truncated,
		}
	}
	const catalogTotalsChanged = (first: StateCatalog, second: StateCatalog): boolean => catalogTypes.some(type => first.totals?.[type] !== second.totals?.[type])
	const catalogPageShifted = (first: StateCatalog, second: StateCatalog, boundaries: Partial<Record<StateTab, string>>): boolean =>
		first.catalogVersion !== second.catalogVersion ||
		catalogTotalsChanged(first, second) ||
		catalogTypes.some(type => {
			const overlap = stateItems(second, type)[0]
			if (overlap === undefined) return first.truncated?.[type] === true
			return entityKey(type, overlap) !== boundaries[type]
		})
	const applyPoolCurrentState = (catalog: StateCatalog): StateCatalog => {
		const poolsByKey = new Map(catalog.pools.map(pool => [`${pool.chain_id}:${pool.pool_address}`, pool]))
		for (const pool of catalog.pools) pool.current_state = {}
		const states = (catalog.poolStates ?? []).toSorted((left, right) => Number(left.block_number) - Number(right.block_number) || Number(left.log_index) - Number(right.log_index))
		for (const state of states) {
			const pool = poolsByKey.get(`${state.chain_id}:${state.pool_address}`)
			if (pool?.current_state !== undefined) Object.assign(pool.current_state, state.state)
		}
		return catalog
	}
	const invalidate = () => {
		catalogRequestVersion++
		pageOffset = 0
		catalogScope = undefined
		pageBoundaryKeys = {}
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
			const chainId = requiredChainId()
			const catalogQuery = new URLSearchParams({ chainId })
			const query = $('#entity-search').value.trim()
			if (query !== '') catalogQuery.set('q', query)
			const requestedEntityKey = deps.getSelectedEntityKey()
			if (requestedEntityKey !== undefined) {
				catalogQuery.set('selectedType', deps.getActiveStateType())
				catalogQuery.set('selectedIdentity', requestedEntityKey.slice(requestedEntityKey.indexOf(':') + 1))
			}
			const scope = `${chainId}:${query}`
			const page = decodeStateCatalog(await api(`/api/v1/state/catalog?${catalogQuery}`))
			const previousData = deps.getStateData()
			const preservePages = live && catalogScope === scope && pageOffset > (page.limit ?? 500) && previousData !== undefined
			let refreshedCatalog = page
			let refreshedBoundaries = pageBoundaries(page)
			const pageSize = page.limit ?? 500
			if (preservePages) {
				const loadedOffset = pageOffset
				for (let offset = pageSize; offset < loadedOffset; offset += pageSize) {
					const continuationQuery = new URLSearchParams({ chainId, offset: String(offset - 1), limit: String(pageSize + 1) })
					if (query !== '') continuationQuery.set('q', query)
					const continuationPage = decodeStateCatalog(await api(`/api/v1/state/catalog?${continuationQuery}`))
					if (catalogPageShifted(refreshedCatalog, continuationPage, refreshedBoundaries)) return await performLoadSystemState({ live: false, contextVersion })
					refreshedCatalog = mergeCatalog(refreshedCatalog, continuationPage)
					refreshedBoundaries = pageBoundaries(continuationPage, refreshedBoundaries)
				}
			}
			const nextStateData = applyPoolCurrentState(refreshedCatalog)
			if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, catalogRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
			const stagedStateType = deps.getActiveStateType()
			const stagedDetailContext = deps.getStateDetailContextVersion()
			const visibleItems = stateItems(nextStateData, stagedStateType)
			const selectedItem = deps.getSelectedEntityKey() === undefined ? visibleItems[0] : visibleItems.find(item => entityKey(stagedStateType, item) === deps.getSelectedEntityKey())
			const stagedSelectedKey = selectedItem === undefined ? undefined : entityKey(stagedStateType, selectedItem)
			const selectedHistory = selectedItem === undefined ? undefined : await fetchEntityHistory(stagedStateType, selectedItem, deps.getSelectedEntityHistoryOffset())
			const currentQuery = $('#entity-search').value.trim()
			const currentVisibleItems = stateItems(nextStateData, stagedStateType)
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
				const reservedQuery = $('#entity-search').value.trim()
				const reservedVisibleItems = stateItems(nextStateData, stagedStateType)
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
				if (!preservePages) pageOffset = page.limit ?? 500
				catalogScope = scope
				pageBoundaryKeys = refreshedBoundaries
				renderStateStats({ live })
				const detailRefreshed = await renderEntityList({ refreshSelected: true, live, selectedHistory, detailGateReserved: true })
				if (live) window.scrollTo({ top: renderScrollY, behavior: 'instant' })
				if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, catalogRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
				status.hidden = true
				alert.hidden = true
				alert.replaceChildren()
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
	const loadMoreSystemState = async (): Promise<boolean> => {
		const current = deps.getStateData()
		const activeType = deps.getActiveStateType()
		if (current === undefined || current.truncated?.[activeType] !== true) return false
		const button = document.querySelector<HTMLButtonElement>('#entity-load-more')
		if (button === null) return false
		const chainId = requiredChainId()
		const query = $('#entity-search').value.trim()
		if (pageOffset < 1 || catalogScope !== `${chainId}:${query}`) return await loadSystemState()
		const offset = pageOffset
		const pageSize = current.limit ?? 500
		const contextVersion = deps.getViewContextVersion()
		const canonicalGeneration = canonicalState.dataGeneration
		const requestVersion = ++catalogRequestVersion
		button.disabled = true
		button.textContent = 'Loading more…'
		try {
			const params = new URLSearchParams({ chainId, offset: String(offset - 1), limit: String(pageSize + 1) })
			if (query !== '') params.set('q', query)
			const page = decodeStateCatalog(await api(`/api/v1/state/catalog?${params}`))
			if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, catalogRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration) || chainId !== requiredChainId() || query !== $('#entity-search').value.trim()) return false
			if (catalogPageShifted(current, page, pageBoundaryKeys)) return await loadSystemState()
			deps.setStateData(applyPoolCurrentState(mergeCatalog(current, page)))
			pageOffset += pageSize
			pageBoundaryKeys = pageBoundaries(page, pageBoundaryKeys)
			renderStateStats()
			await renderEntityList()
			$('#system-alert').hidden = true
			return true
		} catch (error) {
			if (isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, catalogRequestVersion)) {
				const alert = $('#system-alert')
				alert.hidden = false
				alert.textContent = `Could not load more registry entries: ${errorMessage(error)}`
				button.textContent = 'Retry load more'
			}
			return false
		} finally {
			button.disabled = false
		}
	}

	return { loadSystemState, loadMoreSystemState, invalidate }
}
