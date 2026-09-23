import type { EntityHistory, SelectEntityOptions, StateEntity, StateTab } from './browser-types.ts'
import { isRecord } from './api-validation.ts'
import { entityHistoryContinuationPresentation, summarizeHistoryCollections } from './live-update.ts'
import { entityHistoryCollectionKeys } from './state-history-data.ts'

export interface StateHistoryCoverageDeps {
	readonly lookup: (selector: string) => HTMLElement
	readonly element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	readonly entityHistoryCollections: (history: EntityHistory) => Readonly<Record<(typeof entityHistoryCollectionKeys)[number], readonly unknown[]>>
	readonly historyBlockRangeLabel: (oldestBlock: bigint | undefined, newestBlock: bigint | undefined, emptyLabel?: string) => string
	readonly number: (value: string | number | bigint | null | undefined) => string
	readonly selectEntity: (item: StateEntity, options?: SelectEntityOptions) => Promise<boolean>
	readonly isDemo: boolean
	readonly pageUrl: URL
	readonly demoAutoLoadConsumed: boolean
	readonly consumeDemoAutoLoad: () => void
}

const historyCoverageHeadline = (moreAvailable: boolean, partiallyIndexed: boolean) => {
	if (moreAvailable) return 'More history available'
	return partiallyIndexed ? 'Requested range is partially indexed' : 'History loaded'
}

const historySeriesLabel = (key: string): string => {
	if (key === 'snapshots') return 'checkpoints'
	if (key === 'events') return 'lifecycle'
	if (key === 'ammPrices') return 'AMM prices'
	if (key === 'repEthPrices') return 'coordinator prices'
	if (key === 'uniswapRepEthPrices') return 'Uniswap prices'
	if (key === 'openOracleHistory') return 'OpenOracle'
	return key
}

export const renderStateHistoryCoverage = (deps: StateHistoryCoverageDeps, history: EntityHistory, type: StateTab, item: StateEntity): HTMLElement => {
	const { lookup: $, element, entityHistoryCollections, historyBlockRangeLabel, number, selectEntity, isDemo, pageUrl, demoAutoLoadConsumed, consumeDemoAutoLoad } = deps
	const notice = element('section', `history-coverage${history.coverage?.complete === false ? ' incomplete' : ''}`)
	const coverage = history.coverage
	if (coverage?.complete === true && coverage.rangeCovered !== false && coverage.nextCursor === undefined) {
		if ((history.loadedOffset ?? 0) > 0) {
			notice.className = 'sr-only state-history-complete'
			notice.tabIndex = -1
			notice.setAttribute('role', 'status')
			notice.textContent = 'History complete'
		} else notice.hidden = true
		return notice
	}
	if (coverage === undefined) {
		notice.append(element('strong', '', 'History coverage unavailable'), element('span', '', 'This response did not include an indexed range boundary.'))
		return notice
	}
	const collections = entityHistoryCollections(history)
	const recordCollections = Object.fromEntries(entityHistoryCollectionKeys.map(key => [key, collections[key].filter(isRecord)]))
	const summary = summarizeHistoryCollections(recordCollections, entityHistoryCollectionKeys)
	const loadedRange = historyBlockRangeLabel(summary.oldestBlock, summary.newestBlock, 'No block-numbered records loaded')
	const seriesCounts = Object.entries(coverage.series)
		.map(([key, count]) => `${historySeriesLabel(key)} ${number(count)}`)
		.join(' · ')
	const indexedRange = `#${number(coverage.indexedFromBlock)}–${coverage.indexedThroughBlock === undefined ? 'pending' : `#${number(coverage.indexedThroughBlock)}`}`
	const requestedRange = `#${number(coverage.requestedFromBlock)}–#${number(coverage.requestedToBlock)}`
	notice.append(
		element('strong', '', historyCoverageHeadline(coverage.nextCursor !== undefined, coverage.rangeCovered === false)),
		element('span', '', `${loadedRange} · ${seriesCounts || 'no historical series'}. Requested ${requestedRange}; scanner coverage ${indexedRange}.${coverage.rangeCovered === false ? ' Narrow the requested range or backfill the missing blocks.' : ''}`),
	)
	if (coverage.nextCursor !== undefined) {
		const pagination = element('div', 'history-coverage-pagination')
		const showOlder = element('button', 'secondary compact state-history-more', 'Show older history')
		showOlder.type = 'button'
		showOlder.setAttribute('aria-label', `Show older ${type.slice(0, -1)} history`)
		const status = element('p', 'state-history-status')
		status.setAttribute('role', 'status')
		status.setAttribute('aria-live', 'polite')
		showOlder.addEventListener('click', async () => {
			const scrollY = window.scrollY
			const pendingPresentation = entityHistoryContinuationPresentation('pending')
			showOlder.disabled = true
			showOlder.setAttribute('aria-busy', 'true')
			showOlder.textContent = pendingPresentation.buttonLabel
			status.textContent = pendingPresentation.statusText
			status.classList.toggle('sr-only', pendingPresentation.statusVisuallyHidden)
			const loaded = await selectEntity(item, {
				preserveDetail: true,
				pagination: true,
				historyTargetOffset: (history.loadedOffset ?? 0) + coverage.limit,
			})
			if (loaded) {
				const nextControl = $('#state-detail').querySelector<HTMLElement>('.state-history-more, .state-history-complete')
				nextControl?.focus({ preventScroll: true })
				window.scrollTo({ top: scrollY, behavior: 'auto' })
			} else if (showOlder.isConnected) {
				const errorPresentation = entityHistoryContinuationPresentation('error')
				showOlder.disabled = false
				showOlder.removeAttribute('aria-busy')
				showOlder.textContent = errorPresentation.buttonLabel
				status.textContent = errorPresentation.statusText
				status.classList.toggle('sr-only', errorPresentation.statusVisuallyHidden)
				showOlder.focus({ preventScroll: true })
			}
		})
		pagination.append(showOlder, status)
		notice.append(pagination)
		if (isDemo && pageUrl.searchParams.get('stateHistoryAutoLoad') === '1' && !demoAutoLoadConsumed) {
			consumeDemoAutoLoad()
			window.setTimeout(() => {
				if (showOlder.isConnected) {
					showOlder.focus({ preventScroll: true })
					showOlder.click()
				}
			}, 0)
		}
	} else if ((history.loadedOffset ?? 0) > 0) {
		notice.classList.add('state-history-complete')
		notice.tabIndex = -1
		notice.setAttribute('role', 'status')
		notice.setAttribute('aria-live', 'polite')
	}
	return notice
}
