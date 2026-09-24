import { semanticFields } from './semantic-evidence.ts'
import { shortIdentifier } from './identifier-format.ts'
import type { OperationsDetailRoute, OperationsRenderContext } from './browser-types.ts'
import { isRecord, operationRecords, type JsonRecord, type OperationsResponse } from './api-validation.ts'
import { compareCanonicalEventPosition, operationsDetailEvidencePanelVisible, operationsDetailHeaderPresentation, operationsDetailSummaryPresentation, operationsRiskPresentation, summarizeHistoryCollections } from './live-update.ts'
import { exactUnit } from './format.ts'
import { renderCandleContent } from './operations-candles.ts'
import type { createOperationsComponents } from './operations-components.ts'

type Components = ReturnType<typeof createOperationsComponents>

export interface OperationsDetailDeps {
	readonly lookup: (selector: string) => HTMLElement
	readonly captureContext: () => OperationsRenderContext
	readonly restoreContext: (context: OperationsRenderContext) => void
	readonly element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	readonly connection: HTMLElement
	readonly operationsHref: (pathname: string) => string
	readonly approvalTransitionSummary: (item: Readonly<Record<string, unknown>>) => string
	readonly rawEvidence: (value: unknown) => HTMLElement
	readonly operationCounted: (value: unknown, singular: string, plural?: string) => string
	readonly operationRatio: (numerator: unknown, denominator: unknown, maximumFraction?: number) => string
	readonly operationNumber: (value: unknown) => string
	readonly operationsHistoryOffset: (value: unknown) => number | undefined
	readonly operationsRiskHistoryKeys: readonly ['stateSnapshots', 'accountingSnapshots', 'lifecycleEvents', 'liquidations']
	readonly detailEvidenceRows: (items: readonly JsonRecord[]) => HTMLElement[]
	readonly historyBlockRangeLabel: (oldestBlock: bigint | undefined, newestBlock: bigint | undefined, emptyLabel?: string) => string
	readonly isDemo: boolean
	readonly pageUrl: URL
	readonly demoRiskHistoryAutoLoadConsumed: boolean
	readonly consumeDemoRiskHistoryAutoLoad: () => void
	readonly setDetailState: (state: { readonly chainId: string; readonly routeKey: string; readonly items: readonly JsonRecord[]; readonly decisionItems: readonly JsonRecord[]; readonly riskHistoryOffset: number }) => void
	readonly requiredChainId: () => string
	readonly operationsDetailRouteKey: (route: OperationsDetailRoute) => string
	readonly detailEvidenceRowsFor: (kind: OperationsDetailRoute['kind'], items: readonly JsonRecord[]) => HTMLElement[]
	readonly loadOperations: (options?: { live?: boolean; catalogTargetCount?: number; riskPoolTargetCount?: number; riskVaultTargetCount?: number; detailTargetCount?: number; decisionTargetCount?: number; historyTargetOffset?: number; preservedContext?: OperationsRenderContext }) => Promise<boolean>
	readonly components: Components
}

const detailPageRecord = (data: JsonRecord, key: string): JsonRecord => (isRecord(data[key]) ? data[key] : {})

export const renderOperationsDetail = (deps: OperationsDetailDeps, response: OperationsResponse, route: OperationsDetailRoute, preservedContext?: OperationsRenderContext) => {
	const {
		lookup: $,
		captureContext: captureOperationsRenderContext,
		restoreContext: restoreOperationsRenderContext,
		element,
		connection,
		operationsHref,
		approvalTransitionSummary,
		rawEvidence,
		operationCounted,
		operationRatio,
		operationNumber,
		operationsHistoryOffset,
		operationsRiskHistoryKeys,
		detailEvidenceRows,
		historyBlockRangeLabel,
		isDemo,
		pageUrl,
		demoRiskHistoryAutoLoadConsumed,
		requiredChainId,
		operationsDetailRouteKey,
		detailEvidenceRowsFor,
		loadOperations,
	} = deps
	const { operationCard, operationRow, operationsPanel } = deps.components
	const content = $('#operations-content')
	const renderContext = preservedContext ?? captureOperationsRenderContext()
	const data = response.data
	const asOf = response.asOf
	const header = element('section', 'operations-detail-header')
	const back = document.createElement('a')
	const headerPresentation = operationsDetailHeaderPresentation(route.kind, asOf, connection.classList.contains('live'))
	const historical = asOf['historical'] === true || asOf['phase'] === 'historical'
	const catalogPath = headerPresentation.catalogPath
	back.href = operationsHref(catalogPath)
	back.textContent = headerPresentation.backLabel
	const titleIdentity = route.kind === 'vault' ? route.identity[1] : route.identity[0]
	const title = element('h2', '', route.kind === 'report' ? `OpenOracle report ${route.identity[1]}` : `${route.kind[0]?.toUpperCase()}${route.kind.slice(1)} ${shortIdentifier(titleIdentity ?? '')}`)
	header.append(back, title)
	const identity = element('details', 'operations-detail-identity')
	identity.append(element('summary', '', 'Full identity'), element('code', '', route.identity.join(' · ')))
	header.append(identity)
	if (historical) header.append(element('p', 'operations-route-freshness', headerPresentation.freshness))

	const summary = element('div', 'operations-metrics')
	const snapshot = isRecord(data['snapshot']) ? data['snapshot'] : undefined
	const current = isRecord(data['current']) ? data['current'] : undefined
	const lifecycle = current !== undefined && isRecord(current['lifecycle']) ? current['lifecycle'] : undefined
	const summaryPresentation = operationsDetailSummaryPresentation(route.kind, {
		currentEvent: current?.['event_name'],
		lifecycleState: lifecycle?.['state'],
		protocolState: data['protocol_state'],
		scannerSeverity: data['scanner_severity'],
		snapshotReadStatus: snapshot?.['read_status'],
	})
	if (summaryPresentation.label !== 'Evidence state' || summaryPresentation.value !== 'Event-derived') summary.append(operationCard(summaryPresentation.label, summaryPresentation.value))

	const panels: HTMLElement[] = []
	let loadedRiskHistoryOffset = 0
	const decisionPage = route.kind === 'report' ? detailPageRecord(data, 'coordinatorDecisions') : {}
	const decisionItems = operationRecords(decisionPage['items'])
	const approvalEvents = operationRecords(data['approvalEvents']).sort(compareCanonicalEventPosition)
	if (approvalEvents.length > 0)
		panels.push(
			operationsPanel(
				'Liquidation approval lifecycle',
				approvalEvents.map(item => operationRow(String(item['event_name'] ?? 'Liquidation approval'), approvalTransitionSummary(item), String(item['approval_identity'] ?? ''), item['block_number'])),
				'No approval transitions are related to this risk entity.',
			),
		)
	if (snapshot !== undefined)
		panels.push(
			operationsPanel(
				'Current-state snapshot',
				[
					operationRow('Tagged block read', String(snapshot['read_status']), String(snapshot['entity_identity'] ?? ''), snapshot['block_number']),
					...semanticFields(isRecord(snapshot['read_result']) ? snapshot['read_result'] : {}).map(([label, value]) => operationRow(label, value, undefined, undefined)),
					rawEvidence(snapshot),
				],
				'Snapshot unavailable',
			),
		)
	if (current !== undefined) panels.push(operationsPanel('Current report', [operationRow(String(lifecycle?.['state'] ?? current['event_name'] ?? 'Report'), 'Latest canonical report evidence', route.identity.join(':'), current['block_number']), rawEvidence(current)], 'Current report unavailable'))
	if (route.kind === 'pool' || route.kind === 'vault') {
		const riskPresentation = operationsRiskPresentation(route.kind, data['protocol_state'], data['scanner_severity'])
		const protocolStateRow = operationRow('Protocol state', riskPresentation.protocolState, route.identity.join(':'), data['block_number'])
		protocolStateRow.classList.add('operations-risk-protocol')
		const scannerAssessmentRow = operationRow('Scanner assessment', `${riskPresentation.scannerAssessment} · ${String(data['scanner_reason'] ?? 'Current-state evidence unavailable')}`, undefined, data['block_number'])
		scannerAssessmentRow.classList.add('operations-risk-assessment', `operations-risk-${riskPresentation.scannerTone}`)
		panels.push(
			operationsPanel(
				headerPresentation.riskPanelTitle,
				[protocolStateRow, scannerAssessmentRow, ...semanticFields({ ...(isRecord(data['read_result']) ? data['read_result'] : {}), ...(isRecord(data['risk']) ? data['risk'] : {}) }).map(([label, value]) => operationRow(label, value, undefined, data['block_number'])), rawEvidence(data)],
				'Risk state unavailable',
			),
		)
	}
	if (route.kind === 'vault') panels.push(operationsPanel('Accounting', [operationRow('Vault accounting history', 'Backing, capacity ownership and accrued fees', undefined, undefined, operationsHref(`/system?tab=vaults&entity=${requiredChainId()}:${route.identity[0]}:${route.identity[1]}`))], ''))
	if (route.kind === 'trading') {
		const tradingSummary = isRecord(data['summary']) ? data['summary'] : {}
		const twap24h = isRecord(data['twap24h']) ? data['twap24h'] : {}
		const twap7d = isRecord(data['twap7d']) ? data['twap7d'] : {}
		panels.push(
			operationsPanel(
				'Trading summary',
				[
					operationRow('24-hour activity', `${operationCounted(tradingSummary['swaps_24h'], 'swap')} · ${exactUnit(String(tradingSummary['input_volume_24h'] ?? '0'), 18, 'input shares')} · ${exactUnit(String(tradingSummary['fees_24h'] ?? '0'), 18, 'fee shares')}`, undefined, undefined),
					operationRow('Seven-day activity', `${operationCounted(tradingSummary['swaps_7d'], 'swap')} · ${exactUnit(String(tradingSummary['input_volume_7d'] ?? '0'), 18, 'input shares')} · ${exactUnit(String(tradingSummary['fees_7d'] ?? '0'), 18, 'fee shares')}`, undefined, undefined),
					operationRow('24-hour TWAP', `${String(twap24h['state'] ?? 'Unavailable')} · ${operationRatio(twap24h['numerator'], twap24h['denominator'])} NO per YES · ${operationNumber(twap24h['coverageSeconds'])} covered seconds`, 'NO per YES', undefined),
					operationRow('Seven-day TWAP', `${String(twap7d['state'] ?? 'Unavailable')} · ${operationRatio(twap7d['numerator'], twap7d['denominator'])} NO per YES · ${operationNumber(twap7d['coverageSeconds'])} covered seconds`, 'NO per YES', undefined),
				],
				'No trading observations are available.',
			),
		)
		const shares = isRecord(data['sharePositions']) ? data['sharePositions'] : {}
		panels.push(
			operationsPanel(
				'Market share holders',
				operationRecords(shares['items']).map(position =>
					operationRow(
						String(position['address']),
						`${exactUnit(String(position['invalid_atto_shares']), 18, 'INVALID')} · ${exactUnit(String(position['yes_atto_shares']), 18, 'YES')} · ${exactUnit(String(position['no_atto_shares']), 18, 'NO')} · ${exactUnit(String(position['complete_sets_atto_shares']), 18, 'complete sets')}${position['migration_locked'] === true ? ' · Migrated source shares locked' : ''}`,
						undefined,
						undefined,
						operationsHref(`/address/${position['address']}`),
					),
				),
				'No indexed share holders.',
				{ label: `${String(shares['basis'] ?? 'Indexed transfer history')}${shares['truncated'] === true ? ' First 250 holders shown.' : ''}` },
			),
		)
		const lpPositions = operationRecords(data['lpPositions'])
		panels.push(
			operationsPanel(
				'Current LP-share ownership',
				lpPositions.map(position =>
					operationRow('LP holder', `${exactUnit(String(position['balance'] ?? '0'), 18, 'LP shares')} current · ${exactUnit(String(position['received_liquidity'] ?? '0'), 18, '')} received · ${exactUnit(String(position['sent_liquidity'] ?? '0'), 18, '')} sent`, String(position['address'] ?? ''), undefined),
				),
				'No LP-share ownership records match this view. Transfer history begins when this scanner started indexing the pair.',
			),
		)
		panels.push(operationsPanel('Hourly NO-per-YES candles', renderCandleContent(operationRecords(data['candles']), operationRow, operationRatio), 'No reserve observations are available for candles.'))
	}
	if (route.kind === 'report') {
		const decisionPanel = operationsPanel(
			'Coordinator decisions',
			decisionItems.map(decision => {
				const argumentsValue = isRecord(decision['arguments']) ? decision['arguments'] : {}
				return operationRow(String(decision['event_name'] ?? 'Coordinator decision'), String(argumentsValue['reason'] ?? decision['summary'] ?? 'Linked coordinator evidence'), String(decision['emitter_address'] ?? ''), decision['block_number'])
			}),
			'No coordinator decision could be linked to this report.',
		)
		const decisionsHaveMore = decisionPage['hasMore'] === true && typeof decisionPage['nextCursor'] === 'string'
		if (decisionsHaveMore) {
			const loadMore = document.createElement('button')
			loadMore.type = 'button'
			loadMore.className = 'secondary compact operations-detail-more'
			loadMore.dataset['detailCollection'] = 'decisions'
			loadMore.textContent = 'Show older decisions'
			loadMore.setAttribute('aria-label', 'Show older coordinator decisions')
			const loadMoreStatus = element('p', 'activity-summary')
			loadMoreStatus.setAttribute('role', 'status')
			loadMoreStatus.setAttribute('aria-live', 'polite')
			loadMore.addEventListener('click', async () => {
				const paginationContext = captureOperationsRenderContext()
				loadMore.disabled = true
				loadMore.setAttribute('aria-busy', 'true')
				loadMoreStatus.textContent = 'Loading older coordinator decisions…'
				const loaded = await loadOperations({
					live: true,
					decisionTargetCount: decisionItems.length + 100,
					preservedContext: paginationContext,
				})
				if (!loaded && loadMore.isConnected) {
					loadMore.disabled = false
					loadMore.removeAttribute('aria-busy')
					loadMore.textContent = 'Retry older decisions'
					loadMoreStatus.textContent = 'Older coordinator decisions could not be loaded.'
					loadMore.focus({ preventScroll: true })
				}
			})
			decisionPanel.append(loadMore, loadMoreStatus)
		} else if (renderContext.focusDetailCollection === 'decisions') {
			const completeStatus = element('p', 'activity-summary operations-pagination-complete', 'All available coordinator decisions are shown.')
			completeStatus.dataset['detailCollection'] = 'decisions'
			completeStatus.setAttribute('role', 'status')
			completeStatus.setAttribute('aria-live', 'polite')
			completeStatus.tabIndex = -1
			decisionPanel.append(completeStatus)
		}
		panels.push(decisionPanel)
	}
	if (route.kind === 'pool' || route.kind === 'vault') {
		const history = isRecord(data['history']) ? data['history'] : {}
		loadedRiskHistoryOffset = operationsHistoryOffset(history['loadedOffset']) ?? operationsHistoryOffset(history['offset']) ?? 0
		const historyCollections = Object.fromEntries(operationsRiskHistoryKeys.map(key => [key, operationRecords(history[key])]))
		for (const [key, label] of [
			['stateSnapshots', 'Tagged risk history'],
			['accountingSnapshots', 'Accounting checkpoint history'],
			['lifecycleEvents', 'Risk lifecycle events'],
			['liquidations', 'Liquidation history'],
		] as const) {
			const records = historyCollections[key] ?? []
			panels.push(operationsPanel(label, detailEvidenceRows(records), `No ${label.toLowerCase()} available in this view.`))
		}
		const historySummary = summarizeHistoryCollections(historyCollections, operationsRiskHistoryKeys)
		const historyBlockRange = historyBlockRangeLabel(historySummary.oldestBlock, historySummary.newestBlock)
		const historyCounts = [`tagged state ${historySummary.counts['stateSnapshots'] ?? 0}`, `accounting ${historySummary.counts['accountingSnapshots'] ?? 0}`, `lifecycle ${historySummary.counts['lifecycleEvents'] ?? 0}`, `liquidations ${historySummary.counts['liquidations'] ?? 0}`].join(' · ')
		const nextHistoryCursor = history['nextCursor']
		if (history['truncated'] === true && typeof nextHistoryCursor !== 'string') throw new Error('Risk history continuation is malformed')
		if (history['truncated'] === true && typeof nextHistoryCursor === 'string') {
			const nextHistoryOffset = loadedRiskHistoryOffset + (operationsHistoryOffset(history['limit']) ?? 100)
			const coveragePanel = operationsPanel('History coverage', [operationRow('Older evidence remains', `${historyBlockRange} · ${historyCounts}.`, undefined, undefined)], '')
			coveragePanel.id = 'operations-risk-history-coverage'
			const loadMore = document.createElement('button')
			loadMore.type = 'button'
			loadMore.className = 'secondary compact operations-history-more'
			loadMore.textContent = 'Show older evidence'
			loadMore.setAttribute('aria-label', 'Show older pool or vault risk history')
			const loadMoreStatus = element('p', 'operations-history-status')
			loadMoreStatus.setAttribute('role', 'status')
			loadMoreStatus.setAttribute('aria-live', 'polite')
			const pagination = element('div', 'operations-history-pagination')
			const recordPaginationLayout = () => {
				window.requestAnimationFrame(() => {
					if (!pagination.isConnected) return
					const buttonBounds = loadMore.getBoundingClientRect()
					const statusBounds = loadMoreStatus.getBoundingClientRect()
					const separated = buttonBounds.bottom <= statusBounds.top || statusBounds.bottom <= buttonBounds.top
					pagination.dataset['layout'] = separated ? 'separated' : 'overlap'
				})
			}
			loadMore.addEventListener('click', async () => {
				const paginationContext = captureOperationsRenderContext()
				loadMore.disabled = true
				loadMore.setAttribute('aria-busy', 'true')
				loadMoreStatus.textContent = 'Loading older pool and vault evidence…'
				recordPaginationLayout()
				const loaded = await loadOperations({
					live: true,
					historyTargetOffset: nextHistoryOffset,
					preservedContext: paginationContext,
				})
				if (!loaded && loadMore.isConnected) {
					loadMore.disabled = false
					loadMore.removeAttribute('aria-busy')
					loadMore.textContent = 'Retry older evidence'
					loadMoreStatus.textContent = 'Older pool and vault evidence could not be loaded.'
					loadMore.focus({ preventScroll: true })
					recordPaginationLayout()
				}
			})
			pagination.append(loadMore, loadMoreStatus)
			coveragePanel.append(pagination)
			recordPaginationLayout()
			panels.push(coveragePanel)
			if (isDemo && pageUrl.searchParams.get('riskHistoryAutoLoad') === '1' && !demoRiskHistoryAutoLoadConsumed) {
				deps.consumeDemoRiskHistoryAutoLoad()
				window.setTimeout(() => {
					if (loadMore.isConnected) {
						loadMore.focus({ preventScroll: true })
						loadMore.click()
					}
				}, 0)
			}
		} else if (renderContext.focusHistoryMore) {
			const complete = operationsPanel('History coverage', [operationRow('All available risk history is shown', `${historyBlockRange} · ${historyCounts}.`, undefined, undefined)], '')
			complete.id = 'operations-risk-history-coverage'
			complete.classList.add('operations-history-complete')
			complete.tabIndex = -1
			complete.setAttribute('role', 'status')
			complete.setAttribute('aria-live', 'polite')
			panels.push(complete)
		}
	}

	if (isRecord(data['finalization'])) panels.push(operationsPanel('Auction finalization', detailEvidenceRows([data['finalization']]), 'Not finalized'))
	if (route.kind === 'escalation') {
		for (const key of ['deposits', 'claims']) panels.push(operationsPanel(`Loaded ${key}`, detailEvidenceRows(operationRecords(data[key])), `No ${key} in the loaded event page.`))
	}
	if (data['demandCurveTruncated'] === true) panels.push(operationsPanel('Demand curve coverage', [element('p', 'data-note', 'Only the highest 1,000 ticks are shown. Cumulative demand covers these ticks only.')], ''))
	const demand = operationRecords(data['demandCurve'])
	if (demand.length > 0) {
		const demandRows = demand.map(point => operationRow(`Tick ${String(point['tick'])}`, `${exactUnit(String(point['amountAttoEth'] ?? '0'), 18, 'ETH')} · cumulative ${exactUnit(String(point['cumulativeDemandAttoEth'] ?? '0'), 18, 'ETH')}`, String(point['tick']), undefined))
		panels.push(operationsPanel('Demand curve data', demandRows, 'No bids match this view.'))
	}
	const branches = operationRecords(data['branches'])
	if (route.kind === 'fork') {
		const forkSummary = isRecord(data['summary']) ? data['summary'] : {}
		panels.push(
			operationsPanel(
				'Fork migration totals',
				[
					operationRow(
						'Reputation movement',
						`${exactUnit(String(forkSummary['migrated_atto_rep'] ?? '0'), 18, 'REP')} migrated · ${exactUnit(String(forkSummary['burned_atto_rep'] ?? '0'), 18, 'REP')} burned`,
						`${operationCounted(forkSummary['migrator_count'], 'migrator')} · ${operationCounted(forkSummary['child_count'], 'child universe')}`,
						undefined,
					),
					operationRow(
						'Statoblast migration',
						`${operationCounted(forkSummary['pool_migration_events'], 'pool migration event')} · ${operationNumber(forkSummary['obligations_materialized'])}/${operationNumber(forkSummary['obligations_initialized'])} escalation obligations materialized`,
						route.identity[0] ?? '',
						undefined,
					),
				],
				'No fork summary evidence is available.',
			),
		)
	}
	if (branches.length > 0)
		panels.push(
			operationsPanel(
				'Child universe branches',
				branches.map(branch =>
					operationRow(`Child ${String(branch['child_universe_id'])}`, `Outcome ${String(branch['outcome_index'] ?? '—')} · ${exactUnit(String(branch['migrated_atto_rep'] ?? '0'), 18, 'REP')} · ${operationCounted(branch['migrator_count'], 'migrator')}`, String(branch['child_universe_id']), undefined),
				),
				'No child branches match this view.',
			),
		)
	const evidencePage = detailPageRecord(data, route.kind === 'report' ? 'rounds' : 'events')
	const evidenceItems = operationRecords(evidencePage['items'])
	deps.setDetailState({
		chainId: requiredChainId(),
		routeKey: operationsDetailRouteKey(route),
		items: evidenceItems,
		decisionItems,
		riskHistoryOffset: loadedRiskHistoryOffset,
	})
	const evidenceHasMore = evidencePage['hasMore'] === true && typeof evidencePage['nextCursor'] === 'string'
	if (operationsDetailEvidencePanelVisible(route.kind, evidenceItems.length, evidenceHasMore, renderContext.focusLoadMore)) {
		const evidencePanel = operationsPanel(route.kind === 'report' ? 'Report rounds' : 'Lifecycle timeline', detailEvidenceRowsFor(route.kind, evidenceItems), 'No canonical evidence is available.')
		if (evidenceHasMore) {
			const loadMore = document.createElement('button')
			loadMore.type = 'button'
			loadMore.className = 'secondary compact operations-detail-more'
			loadMore.dataset['detailCollection'] = 'evidence'
			loadMore.textContent = 'Show older evidence'
			loadMore.setAttribute('aria-label', 'Show older canonical evidence')
			const loadMoreStatus = element('p', 'activity-summary')
			loadMoreStatus.setAttribute('role', 'status')
			loadMoreStatus.setAttribute('aria-live', 'polite')
			loadMore.addEventListener('click', async () => {
				const paginationContext = captureOperationsRenderContext()
				loadMore.disabled = true
				loadMore.setAttribute('aria-busy', 'true')
				loadMoreStatus.textContent = 'Loading older canonical evidence…'
				const loaded = await loadOperations({
					live: true,
					detailTargetCount: evidenceItems.length + 100,
					preservedContext: paginationContext,
				})
				if (!loaded && loadMore.isConnected) {
					loadMore.disabled = false
					loadMore.removeAttribute('aria-busy')
					loadMore.textContent = 'Retry older evidence'
					loadMoreStatus.textContent = 'Older canonical evidence could not be loaded.'
					loadMore.focus({ preventScroll: true })
				}
			})
			evidencePanel.append(loadMore, loadMoreStatus)
		} else if (renderContext.focusDetailCollection === 'evidence') {
			const completeStatus = element('p', 'activity-summary operations-pagination-complete', 'All available evidence is shown.')
			completeStatus.dataset['detailCollection'] = 'evidence'
			completeStatus.setAttribute('role', 'status')
			completeStatus.setAttribute('aria-live', 'polite')
			completeStatus.tabIndex = -1
			evidencePanel.append(completeStatus)
		}
		panels.push(evidencePanel)
	}
	const grid = element('div', 'operations-grid operations-grid-single')
	const canonicalDetail = !location.pathname.startsWith('/operations/')
	if (canonicalDetail) {
		const selectedTab = pageUrl.searchParams.get('tab')
		const activeTab = selectedTab === 'history' || selectedTab === 'evidence' ? selectedTab : 'overview'
		const tabs = element('nav', 'entity-detail-tabs')
		tabs.setAttribute('aria-label', 'Entity sections')
		for (const [key, label] of [
			['overview', 'Overview'],
			['history', 'History'],
			['evidence', 'Evidence'],
		] as const) {
			const target = new URL(location.href)
			if (key === 'overview') target.searchParams.delete('tab')
			else target.searchParams.set('tab', key)
			const anchor = element('a', '', label)
			anchor.href = `${target.pathname}${target.search}`
			if (key === activeTab) anchor.setAttribute('aria-current', 'page')
			tabs.append(anchor)
		}
		const grouped = panels.filter(panel => {
			const heading = panel.querySelector('h3')?.textContent ?? ''
			const historyPanel = /history|timeline|rounds|candles|curve/i.test(heading)
			const evidencePanel = /evidence|decision|receipt|event/i.test(heading)
			if (activeTab === 'overview') return !historyPanel && !evidencePanel
			if (activeTab === 'history') return historyPanel
			return evidencePanel
		})
		grid.append(...(grouped.length > 0 ? grouped : [element('p', 'state-placeholder', `No ${activeTab} records are available.`)]))
		content.replaceChildren(header, tabs, ...(summary.childElementCount === 0 ? [] : [summary]), grid)
	} else {
		grid.append(...panels)
		content.replaceChildren(header, ...(summary.childElementCount === 0 ? [] : [summary]), grid)
	}
	content.setAttribute('aria-busy', 'false')
	$('#operations-status').hidden = true
	restoreOperationsRenderContext(renderContext)
}
