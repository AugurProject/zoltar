import type { EntityHistory, PoolRecord, RenderEntityListOptions, SelectEntityOptions, StateCatalog, StateEntity, StateTab, QuestionRecord, UniverseRecord, VaultRecord } from './browser-types.ts'
import type { SystemRouteState } from './system-route-state.ts'
import type { CanonicalState } from './canonical-state.ts'
import type { RefreshGate } from './live-update.ts'
import { isCurrentCanonicalGeneration, isCurrentContextRequest, refreshPresentation } from './live-update.ts'
import { exactUnit } from './format.ts'
import { short, shortIdentifier } from './identifier-format.ts'
import { questionStatus } from './question-time.ts'

interface SystemRouteDeps {
	state: SystemRouteState
	canonicalState: CanonicalState
	lookup: {
		(selector: '#entity-search'): HTMLInputElement
		(selector: string): HTMLElement
	}
	element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	number: (value: string | number | bigint | null | undefined) => string
	counted: (value: string | number | bigint | null | undefined, singular: string, plural?: string) => string
	nativeSymbol: (chainId?: string) => string
	fetchEntityHistory: (type: StateTab, item: StateEntity, offset: number) => Promise<EntityHistory>
	renderPoolDetail: (item: PoolRecord, requestVersion: number, canonicalGeneration: number, history?: EntityHistory) => Promise<void>
	renderVaultDetail: (item: VaultRecord, requestVersion: number, canonicalGeneration: number, history?: EntityHistory) => Promise<void>
	renderQuestionDetail: (item: QuestionRecord, requestVersion: number, canonicalGeneration: number, history?: EntityHistory) => Promise<void>
	renderUniverseDetail: (item: UniverseRecord, requestVersion: number, canonicalGeneration: number, history?: EntityHistory) => Promise<void>
	systemDetailRefreshGate: RefreshGate
	liveSnapshot: (container: ParentNode, selector?: string) => Map<string, string>
	setLiveRecord: <T extends HTMLElement>(node: T, key: string, value: unknown) => T
	applyLiveChanges: (container: ParentNode, previous: ReadonlyMap<string, string>, options?: { live?: boolean; selector?: string }) => { added: number; changed: number }
	errorMessage: (error: unknown) => string
	retryCanonicalViewOr: (fallback: () => Promise<boolean>) => Promise<boolean>
	navigateToCanonicalEntity: (type: StateTab, item: StateEntity) => void
}

export const createSystemRoute = (deps: SystemRouteDeps) => {
	const { state: systemRouteState, canonicalState, element, number, counted, nativeSymbol, fetchEntityHistory, renderPoolDetail, renderVaultDetail, renderQuestionDetail, renderUniverseDetail, systemDetailRefreshGate, liveSnapshot, setLiveRecord, applyLiveChanges, errorMessage, retryCanonicalViewOr } = deps
	const $ = deps.lookup
	const entityKey = (type: StateTab, item: StateEntity): string => {
		if (type === 'pools' && 'pool_address' in item) return `${item.chain_id}:${item.pool_address}`
		if (type === 'vaults' && 'vault_address' in item) return `${item.chain_id}:${item.pool_address}:${item.vault_address}`
		if (type === 'questions' && 'question_id' in item) return `${item.chain_id}:${item.question_id}`
		if ('universe_id' in item) return `${item.chain_id}:${item.universe_id}`
		throw new Error(`State entity does not match the selected ${type} tab`)
	}

	const entityCopy = (type: StateTab, item: StateEntity): [string, string] => {
		if (type === 'pools' && 'settlement_collateral_atto_eth' in item) return [item.question_title ?? short(item.pool_address), `${short(item.pool_address, 8, 6)} · ${counted(item.vault_count, 'vault')} · ${exactUnit(item.settlement_collateral_atto_eth, 18, nativeSymbol(item.chain_id))}`]
		if (type === 'vaults' && 'vault_address' in item) return [short(item.vault_address, 10, 6), `${exactUnit(item.capacity_ownership_atto_rep, 18, 'REP')} capacity`]
		if (type === 'questions' && 'outcome_options' in item) return [item.title, `${questionStatus(item)} · ${counted(item.pool_count, 'pool')}`]
		if ('universe_id' in item && 'pool_count' in item) return [item.universe_id === '0' ? 'Genesis universe' : `Universe ${shortIdentifier(item.universe_id, 9, 6)}`, `${counted(item.child_count, 'child', 'children')} · ${counted(item.pool_count, 'pool')}`]
		throw new Error(`State entity does not match the selected ${type} tab`)
	}

	const performSelectEntity = async (item: StateEntity, { preserveDetail = false, quiet = false, pagination = false, historyTargetOffset, contextVersion, suppliedHistory }: SelectEntityOptions = {}): Promise<boolean> => {
		if (contextVersion !== systemRouteState.detailContextVersion) return false
		const canonicalGeneration = canonicalState.dataGeneration
		const nextEntityKey = entityKey(systemRouteState.activeType, item)
		if (systemRouteState.selectedKey !== nextEntityKey) systemRouteState.historyOffset = 0
		systemRouteState.selectedKey = nextEntityKey
		const targetHistoryOffset = historyTargetOffset ?? systemRouteState.historyOffset
		for (const row of document.querySelectorAll<HTMLElement>('.entity-row')) row.setAttribute('aria-selected', String(row.dataset.key === systemRouteState.selectedKey))
		const requestVersion = ++systemRouteState.detailRequestVersion
		const detail = $('#state-detail')
		const presentation = refreshPresentation({ live: quiet })
		detail.setAttribute('aria-busy', String(presentation.busy))
		const replaceWithLoading = presentation.loadingState && (!preserveDetail || detail.childElementCount === 0)
		const existingRefreshStatus = detail.querySelector<HTMLElement>('.detail-refresh-status')
		if (presentation.loadingState) existingRefreshStatus?.remove()
		let refreshStatus = presentation.loadingState ? undefined : existingRefreshStatus
		if (replaceWithLoading) detail.replaceChildren(element('div', 'state-placeholder', 'Loading historical checkpoints…'))
		else if (!quiet && !pagination) {
			refreshStatus = element('div', 'system-status detail-refresh-status', 'Refreshing historical checkpoints…')
			refreshStatus.setAttribute('role', 'status')
			detail.prepend(refreshStatus)
		}
		if (location.pathname === '/system') {
			const url = new URL(location.href)
			url.searchParams.set('tab', systemRouteState.activeType)
			url.searchParams.set('entity', systemRouteState.selectedKey)
			history.replaceState(null, '', url)
		}
		try {
			const loadedHistory = suppliedHistory ?? (await fetchEntityHistory(systemRouteState.activeType, item, targetHistoryOffset))
			if (systemRouteState.activeType === 'pools' && 'settlement_collateral_atto_eth' in item) await renderPoolDetail(item, requestVersion, canonicalGeneration, loadedHistory)
			if (systemRouteState.activeType === 'vaults' && 'vault_address' in item) await renderVaultDetail(item, requestVersion, canonicalGeneration, loadedHistory)
			if (systemRouteState.activeType === 'questions' && 'outcome_options' in item) await renderQuestionDetail(item, requestVersion, canonicalGeneration, loadedHistory)
			if (systemRouteState.activeType === 'universes' && 'reputation_token_address' in item) await renderUniverseDetail(item, requestVersion, canonicalGeneration, loadedHistory)
			const current = isCurrentContextRequest(contextVersion, systemRouteState.detailContextVersion, requestVersion, systemRouteState.detailRequestVersion) && isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)
			if (current) systemRouteState.historyOffset = loadedHistory.loadedOffset ?? 0
			return current
		} catch (error) {
			if (isCurrentContextRequest(contextVersion, systemRouteState.detailContextVersion, requestVersion, systemRouteState.detailRequestVersion) && isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) {
				if (pagination) {
					// The pagination control remains mounted and presents its local retry state.
				} else if (replaceWithLoading) {
					const failure = element('div', 'state-error')
					failure.append(element('span', '', `State history unavailable: ${errorMessage(error)}`))
					const retry = element('button', '', 'Retry')
					retry.type = 'button'
					retry.addEventListener('click', () => retryCanonicalViewOr(() => selectEntity(item)))
					failure.append(retry)
					detail.replaceChildren(failure)
				} else {
					const failure = refreshStatus ?? element('div', 'system-status detail-refresh-status')
					failure.classList.add('error')
					failure.setAttribute('role', 'alert')
					failure.replaceChildren(element('span', '', `Historical refresh failed; showing last known details: ${errorMessage(error)}`))
					const retry = element('button', '', 'Retry')
					retry.type = 'button'
					retry.addEventListener('click', () => retryCanonicalViewOr(() => selectEntity(item, { preserveDetail: true })))
					failure.append(retry)
					if (refreshStatus === undefined) detail.prepend(failure)
				}
			}
			return false
		} finally {
			if (isCurrentContextRequest(contextVersion, systemRouteState.detailContextVersion, requestVersion, systemRouteState.detailRequestVersion) && isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) $('#state-detail').setAttribute('aria-busy', 'false')
		}
	}

	const selectEntity = (item: StateEntity, options: SelectEntityOptions = {}): Promise<boolean> => {
		if (options.quiet !== true) {
			systemRouteState.detailContextVersion++
			systemRouteState.detailRequestVersion++
		}
		const contextVersion = systemRouteState.detailContextVersion
		const operation = () => performSelectEntity(item, { ...options, contextVersion })
		return options.quiet === true ? systemDetailRefreshGate.runBackground(operation) : systemDetailRefreshGate.runForeground(operation)
	}

	const selectEntityWhileReserved = (item: StateEntity, options: SelectEntityOptions = {}): Promise<boolean> => {
		if (options.quiet !== true) {
			systemRouteState.detailContextVersion++
			systemRouteState.detailRequestVersion++
		}
		return performSelectEntity(item, { ...options, contextVersion: systemRouteState.detailContextVersion })
	}

	const stateItems = (catalog: StateCatalog, type: StateTab): StateEntity[] => {
		if (type === 'pools') return catalog.pools
		if (type === 'vaults') return catalog.vaults
		if (type === 'questions') return catalog.questions
		return catalog.universes
	}

	const renderEntityList = async ({ refreshSelected = false, live = false, selectedHistory, detailGateReserved = false }: RenderEntityListOptions = {}): Promise<boolean> => {
		const query = $('#entity-search').value.trim().toLowerCase()
		if (systemRouteState.data === undefined) throw new Error('System state catalog is unavailable')
		const catalogItems = stateItems(systemRouteState.data, systemRouteState.activeType)
		const items = catalogItems
		$('#entity-list-title').textContent = `All ${systemRouteState.activeType}`
		const total = systemRouteState.data.totals?.[systemRouteState.activeType] ?? items.length
		const hasMore = systemRouteState.data.truncated?.[systemRouteState.activeType] === true && (query !== '' || catalogItems.length < total)
		let countLabel = number(items.length)
		if (query) countLabel = `${countLabel} shown`
		else if (hasMore) countLabel = `${countLabel} of ${number(total)}`
		$('#entity-count').textContent = countLabel
		$('#entity-count').title = hasMore ? 'More registry entries are available.' : ''
		$('#entity-search').placeholder = `Search ${systemRouteState.activeType}…`
		const loadMore = $('#entity-load-more')
		loadMore.hidden = !hasMore
		loadMore.textContent = `Show more ${systemRouteState.activeType}`
		const list = $('#entity-list')
		const previousRows = liveSnapshot(list, '.entity-row[data-live-key]')
		list.replaceChildren()
		for (const item of items) {
			const [title, meta] = entityCopy(systemRouteState.activeType, item)
			const row = setLiveRecord(element('button', 'entity-row'), entityKey(systemRouteState.activeType, item), item)
			row.type = 'button'
			row.dataset.key = entityKey(systemRouteState.activeType, item)
			row.setAttribute('role', 'option')
			row.setAttribute('aria-selected', String(row.dataset.key === systemRouteState.selectedKey))
			row.append(element('span', 'entity-row-title', title), element('span', 'entity-row-meta', meta))
			row.addEventListener('click', () => {
				if (location.pathname === '/system') void selectEntity(item)
				else deps.navigateToCanonicalEntity(systemRouteState.activeType, item)
			})
			list.append(row)
		}
		applyLiveChanges(list, previousRows, { live, selector: '.entity-row[data-live-key]' })
		list.setAttribute('aria-busy', 'false')
		const selected = items.find(item => entityKey(systemRouteState.activeType, item) === systemRouteState.selectedKey)
		if (selected !== undefined) {
			if (refreshSelected) {
				const select = detailGateReserved ? selectEntityWhileReserved : selectEntity
				return await select(selected, { preserveDetail: true, quiet: live, suppliedHistory: selectedHistory })
			}
			return true
		}
		if (systemRouteState.selectedKey !== undefined && !items.some(item => entityKey(systemRouteState.activeType, item) === systemRouteState.selectedKey)) {
			$('#state-detail').setAttribute('aria-busy', 'false')
			$('#state-detail').replaceChildren(element('div', 'state-error', catalogItems.some(item => entityKey(systemRouteState.activeType, item) === systemRouteState.selectedKey) ? 'The current filter hides this entity.' : 'Entity not found in this network.'))
			return true
		}
		if (location.pathname === '/system' && items[0] !== undefined) {
			const select = detailGateReserved ? selectEntityWhileReserved : selectEntity
			return await select(items[0], { preserveDetail: live, quiet: live, suppliedHistory: selectedHistory })
		}
		systemRouteState.detailContextVersion++
		systemRouteState.detailRequestVersion++
		systemRouteState.selectedKey = undefined
		$('#state-detail').setAttribute('aria-busy', 'false')
		$('#state-detail').replaceChildren(element('div', 'state-placeholder', `No ${systemRouteState.activeType} match this view.`))
		return true
	}

	const renderStateStats = ({ live = false } = {}) => {
		if (systemRouteState.data === undefined) throw new Error('System state catalog is unavailable')
		const stats = $('#state-stats')
		const previousStats = liveSnapshot(stats, '.state-stat[data-live-key]')
		stats.replaceChildren()
		const statGroups: Array<readonly [string, keyof NonNullable<StateCatalog['totals']>, readonly StateEntity[]]> = [
			['Pools', 'pools', systemRouteState.data.pools],
			['Questions', 'questions', systemRouteState.data.questions],
			['Vaults', 'vaults', systemRouteState.data.vaults],
			['Universes', 'universes', systemRouteState.data.universes],
		]
		for (const [label, key, items] of statGroups) {
			const total = systemRouteState.data.totals?.[key] ?? items.length
			const card = setLiveRecord(element('div', 'state-stat'), label.toLowerCase(), String(total))
			card.append(element('span', '', label), element('strong', '', number(total)))
			stats.append(card)
		}
		applyLiveChanges(stats, previousStats, { live, selector: '.state-stat[data-live-key]' })
		stats.setAttribute('aria-busy', 'false')
	}

	const setSystemControlsDisabled = (disabled: boolean) => {
		$('#entity-search').disabled = disabled
		for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-state-tab]')) tab.disabled = disabled
		for (const row of document.querySelectorAll<HTMLButtonElement>('.entity-row')) row.disabled = disabled
	}

	const setStateTab = (type: StateTab, restoredEntityKey?: string) => {
		systemRouteState.detailContextVersion++
		systemRouteState.detailRequestVersion++
		systemRouteState.activeType = type
		systemRouteState.selectedKey = restoredEntityKey
		systemRouteState.historyOffset = 0
		$('#state-detail').setAttribute('aria-busy', 'false')
		for (const tab of document.querySelectorAll<HTMLElement>('[data-state-tab]')) {
			const selected = tab.dataset.stateTab === type
			tab.setAttribute('aria-selected', String(selected))
			tab.tabIndex = selected ? 0 : -1
		}
		$('#state-detail').setAttribute('aria-labelledby', `tab-${type}`)
		if (systemRouteState.data !== undefined) void renderEntityList()
	}

	return { entityKey, entityCopy, selectEntity, stateItems, renderEntityList, renderStateStats, setSystemControlsDisabled, setStateTab }
}
