import { $, element, operationNumber, operationCounted, operationCard, operationRow, operationsPanel, historyBlockRangeLabel } from './view-presentation.ts'
import { exactUnit } from './chart-view.ts'
import { shortIdentifier } from './identifier-format.ts'
import { type OperationsDetailRoute, type OperationsRenderContext } from './browser-types.ts'
import { isRecord, operationRecords, type JsonRecord, type OperationsResponse } from './api-validation.ts'
import { compareCanonicalEventPosition, operationsDetailEvidencePanelVisible, operationsDetailHeaderPresentation, operationsDetailSummaryPresentation, operationsRiskPresentation, summarizeHistoryCollections } from './live-update.ts'

type OperationsDetailViewContext = {
	captureOperationsRenderContext: () => OperationsRenderContext
	connection: HTMLElement
	operationsHref: (pathname: string) => string
	detailPageRecord: (data: JsonRecord, key: string) => JsonRecord
	approvalTransitionSummary: (item: Readonly<Record<string, unknown>>) => string
	operationRatio: (numerator: unknown, denominator: unknown, maximumFraction?: number) => string
	loadOperations: ({
		live,
		catalogTargetCount,
		riskPoolTargetCount,
		riskVaultTargetCount,
		detailTargetCount,
		decisionTargetCount,
		historyTargetOffset,
		preservedContext,
	}?: {
		live?: boolean
		catalogTargetCount?: number
		riskPoolTargetCount?: number
		riskVaultTargetCount?: number
		detailTargetCount?: number
		decisionTargetCount?: number
		historyTargetOffset?: number
		preservedContext?: OperationsRenderContext
	}) => Promise<boolean>
	operationsHistoryOffset: (value: unknown) => number | undefined
	operationsRiskHistoryKeys: readonly ['stateSnapshots', 'accountingSnapshots', 'lifecycleEvents', 'liquidations']
	isDemo: boolean
	pageUrl: URL
	demoRiskHistoryAutoLoadConsumed: boolean
	operationsDetailState: { readonly chainId: string; readonly routeKey: string; readonly items: readonly JsonRecord[]; readonly decisionItems: readonly JsonRecord[]; readonly riskHistoryOffset: number } | undefined
	requiredChainId: () => string
	operationsDetailRouteKey: (route: OperationsDetailRoute) => string
	detailEvidenceRowsFor: (kind: OperationsDetailRoute['kind'], items: readonly JsonRecord[]) => (HTMLAnchorElement | HTMLDivElement)[]
	restoreOperationsRenderContext: (snapshot: OperationsRenderContext) => void
}

export function createOperationsDetailView(context: OperationsDetailViewContext) {
	const rawEvidence = (value: unknown) => {
		const disclosure = document.createElement('details')
		disclosure.className = 'operations-raw-evidence'
		disclosure.append(element('summary', '', 'Raw chain evidence'))
		const raw = document.createElement('pre')
		raw.textContent = JSON.stringify(value, null, 2) ?? 'Unavailable'
		disclosure.append(raw)
		return disclosure
	}

	const detailEvidenceRows = (items: readonly JsonRecord[]) =>
		items.map(item => {
			const eventName = String(item['event_name'] ?? item['semantic_event_kind'] ?? 'Protocol evidence')
			const block = item['block_number']
			const row = operationRow(eventName, `Canonical event · log ${String(item['log_index'] ?? '—')}`, String(item['tx_hash'] ?? ''), block)
			row.append(rawEvidence(item))
			return row
		})

	const tradingEvidenceRows = (items: readonly JsonRecord[]) =>
		items.map(item => {
			const eventName = String(item['event_name'] ?? 'AMM event')
			const data = isRecord(item['event_data']) ? item['event_data'] : {}
			const analytics = isRecord(item['analytics']) ? item['analytics'] : {}
			let summary = 'Canonical AMM lifecycle evidence'
			if (eventName === 'Swap')
				summary = `${String(analytics['direction'] ?? 'Swap')} · ${exactUnit(String(analytics['amountIn'] ?? '0'), 18, String(analytics['baseAsset'] ?? 'shares'), 4)} in → ${exactUnit(String(analytics['amountOut'] ?? '0'), 18, String(analytics['quoteAsset'] ?? 'shares'), 4)} out · ${exactUnit(String(analytics['feeAmount'] ?? '0'), 18, 'shares', 6)} fee${isRecord(analytics['priceImpact']) && analytics['priceImpact']['bps'] !== undefined ? ` · ${exactUnit(String(analytics['priceImpact']['bps']), 2, '%', 2)} impact` : ''}`
			else if (eventName === 'Sync') summary = `${exactUnit(String(data['yesReserve'] ?? '0'), 18, 'YES', 4)} · ${exactUnit(String(data['noReserve'] ?? '0'), 18, 'NO', 4)} reserves`
			else if (eventName === 'Transfer') summary = `${exactUnit(String(data['amount'] ?? '0'), 18, 'LP shares', 4)} · ${shortIdentifier(String(data['from'] ?? ''))} → ${shortIdentifier(String(data['to'] ?? ''))}`
			else if (eventName === 'Approval') summary = `${exactUnit(String(data['amount'] ?? '0'), 18, 'LP shares', 4)} · ${shortIdentifier(String(data['owner'] ?? ''))} approved ${shortIdentifier(String(data['spender'] ?? ''))}`
			else if (eventName.startsWith('Liquidity')) summary = `${exactUnit(String(data['yesAmount'] ?? '0'), 18, 'YES', 4)} · ${exactUnit(String(data['noAmount'] ?? '0'), 18, 'NO', 4)} · ${exactUnit(String(data['liquidity'] ?? '0'), 18, 'LP shares', 4)}`
			const row = operationRow(eventName, summary, String(data['provider'] ?? data['sender'] ?? item['tx_hash'] ?? ''), item['block_number'])
			row.append(rawEvidence(item))
			return row
		})

	const reportEvidenceRows = (items: readonly JsonRecord[]) =>
		items.map(item => {
			const data = isRecord(item['report_data']) ? item['report_data'] : {}
			const token1 = String(data['token1'] ?? 'token 1')
			const token2 = String(data['token2'] ?? 'token 2')
			const values = data['currentAmount1'] === undefined && data['currentAmount2'] === undefined ? 'No round amounts' : `${operationNumber(data['currentAmount1'])} ${shortIdentifier(token1)} · ${operationNumber(data['currentAmount2'])} ${shortIdentifier(token2)}`
			const comparison = isRecord(item['comparison']) ? item['comparison'] : {}
			const changes = operationRecords(comparison['changes'])
			const row = operationRow(`${String(item['event_name'] ?? 'Report round')} · round ${String(item['round_number'] ?? '—')}`, `${values} · reporter ${shortIdentifier(String(data['currentReporter'] ?? 'unknown'))}`, String(item['tx_hash'] ?? ''), item['block_number'])
			const changeDetails = document.createElement('details')
			changeDetails.className = 'operations-round-changes'
			changeDetails.append(element('summary', '', comparison['state'] === 'initial' ? `Initial values (${changes.length})` : `Changes from round ${String(comparison['previousRoundNumber'] ?? '—')} (${changes.length})`))
			const changeList = document.createElement('ul')
			for (const change of changes) {
				const before = change['before'] === undefined ? 'not set' : JSON.stringify(change['before'])
				const after = change['after'] === undefined ? 'not set' : JSON.stringify(change['after'])
				changeList.append(element('li', '', `${String(change['field'] ?? 'field')}: ${before ?? 'unavailable'} → ${after ?? 'unavailable'}`))
			}
			if (changes.length === 0) changeList.append(element('li', '', 'No report fields changed.'))
			changeDetails.append(changeList)
			row.append(changeDetails)
			row.append(rawEvidence(item))
			return row
		})

	const renderOperationsDetail = (response: OperationsResponse, route: OperationsDetailRoute, preservedContext?: OperationsRenderContext) => {
		const content = $('#operations-content')
		const renderContext = preservedContext ?? context.captureOperationsRenderContext()
		const data = response.data
		const asOf = response.asOf
		const header = element('section', 'operations-detail-header')
		const back = document.createElement('a')
		const headerPresentation = operationsDetailHeaderPresentation(route.kind, asOf, context.connection.classList.contains('live'))
		const historical = asOf['historical'] === true || asOf['phase'] === 'historical'
		const catalogPath = headerPresentation.catalogPath
		back.href = context.operationsHref(catalogPath)
		back.textContent = headerPresentation.backLabel
		const titleIdentity = route.kind === 'vault' ? route.identity[1] : route.identity[0]
		const title = element('h2', '', route.kind === 'report' ? `OpenOracle report ${route.identity[1]}` : `${route.kind[0]?.toUpperCase()}${route.kind.slice(1)} ${shortIdentifier(titleIdentity ?? '')}`)
		header.append(back, title)
		if (historical) header.append(element('p', 'operations-route-freshness', headerPresentation.freshness))

		const summary = element('div', 'operations-metrics')
		const snapshot = isRecord(data['snapshot']) ? data['snapshot'] : undefined
		const taggedEvidence = snapshot !== undefined || typeof data['source_method'] === 'string'
		const current = isRecord(data['current']) ? data['current'] : undefined
		const lifecycle = current !== undefined && isRecord(current['lifecycle']) ? current['lifecycle'] : undefined
		const summaryPresentation = operationsDetailSummaryPresentation(route.kind, {
			currentEvent: current?.['event_name'],
			lifecycleState: lifecycle?.['state'],
			protocolState: data['protocol_state'],
			scannerSeverity: data['scanner_severity'],
			snapshotReadStatus: snapshot?.['read_status'],
		})
		summary.append(operationCard(summaryPresentation.label, summaryPresentation.value), operationCard('Evidence source', taggedEvidence ? 'Tagged contract read' : 'Canonical events'), operationCard('Entity identity', route.identity.join(' · ')))

		const panels: HTMLElement[] = []
		let loadedRiskHistoryOffset = 0
		const decisionPage = route.kind === 'report' ? context.detailPageRecord(data, 'coordinatorDecisions') : {}
		const decisionItems = operationRecords(decisionPage['items'])
		const approvalEvents = operationRecords(data['approvalEvents']).sort(compareCanonicalEventPosition)
		if (approvalEvents.length > 0)
			panels.push(
				operationsPanel(
					'Liquidation approval lifecycle',
					approvalEvents.map(item => operationRow(String(item['event_name'] ?? 'Liquidation approval'), context.approvalTransitionSummary(item), String(item['approval_identity'] ?? ''), item['block_number'])),
					'No approval transitions are related to this risk entity.',
				),
			)
		if (snapshot !== undefined) panels.push(operationsPanel('Current-state snapshot', [operationRow('Tagged block read', String(snapshot['read_status']), String(snapshot['entity_identity'] ?? ''), snapshot['block_number']), rawEvidence(snapshot)], 'Snapshot unavailable'))
		if (current !== undefined) panels.push(operationsPanel('Current report', [operationRow(String(lifecycle?.['state'] ?? current['event_name'] ?? 'Report'), 'Latest canonical report evidence', route.identity.join(':'), current['block_number']), rawEvidence(current)], 'Current report unavailable'))
		if (route.kind === 'pool' || route.kind === 'vault') {
			const riskPresentation = operationsRiskPresentation(route.kind, data['protocol_state'], data['scanner_severity'])
			const protocolStateRow = operationRow('Protocol state', riskPresentation.protocolState, route.identity.join(':'), data['block_number'])
			protocolStateRow.classList.add('operations-risk-protocol')
			const scannerAssessmentRow = operationRow('Scanner assessment', `${riskPresentation.scannerAssessment} · ${String(data['scanner_reason'] ?? 'Current-state evidence unavailable')}`, undefined, data['block_number'])
			scannerAssessmentRow.classList.add('operations-risk-assessment', `operations-risk-${riskPresentation.scannerTone}`)
			panels.push(operationsPanel(headerPresentation.riskPanelTitle, [protocolStateRow, scannerAssessmentRow, rawEvidence(data)], 'Risk state unavailable'))
		}
		if (route.kind === 'trading') {
			const tradingSummary = isRecord(data['summary']) ? data['summary'] : {}
			const twap24h = isRecord(data['twap24h']) ? data['twap24h'] : {}
			const twap7d = isRecord(data['twap7d']) ? data['twap7d'] : {}
			panels.push(
				operationsPanel(
					'Trading summary',
					[
						operationRow('24-hour activity', `${operationCounted(tradingSummary['swaps_24h'], 'swap')} · ${exactUnit(String(tradingSummary['input_volume_24h'] ?? '0'), 18, 'input shares', 4)} · ${exactUnit(String(tradingSummary['fees_24h'] ?? '0'), 18, 'fee shares', 6)}`, route.identity[0] ?? '', undefined),
						operationRow('Seven-day activity', `${operationCounted(tradingSummary['swaps_7d'], 'swap')} · ${exactUnit(String(tradingSummary['input_volume_7d'] ?? '0'), 18, 'input shares', 4)} · ${exactUnit(String(tradingSummary['fees_7d'] ?? '0'), 18, 'fee shares', 6)}`, route.identity[0] ?? '', undefined),
						operationRow('24-hour TWAP', `${String(twap24h['state'] ?? 'Unavailable')} · ${context.operationRatio(twap24h['numerator'], twap24h['denominator'])} NO per YES · ${operationNumber(twap24h['coverageSeconds'])} covered seconds`, 'NO per YES', undefined),
						operationRow('Seven-day TWAP', `${String(twap7d['state'] ?? 'Unavailable')} · ${context.operationRatio(twap7d['numerator'], twap7d['denominator'])} NO per YES · ${operationNumber(twap7d['coverageSeconds'])} covered seconds`, 'NO per YES', undefined),
					],
					'No trading observations are available.',
				),
			)
			const lpPositions = operationRecords(data['lpPositions'])
			panels.push(
				operationsPanel(
					'Current LP-share ownership',
					lpPositions.map(position =>
						operationRow('LP holder', `${exactUnit(String(position['balance'] ?? '0'), 18, 'LP shares', 5)} current · ${exactUnit(String(position['received_liquidity'] ?? '0'), 18, '', 5)} received · ${exactUnit(String(position['sent_liquidity'] ?? '0'), 18, '', 5)} sent`, String(position['address'] ?? ''), undefined),
					),
					'No LP-share ownership records match this view. Transfer history begins when this scanner started indexing the pair.',
				),
			)
			const candles = operationRecords(data['candles'])
			panels.push(
				operationsPanel(
					'Hourly NO-per-YES candles',
					candles.map(candle => {
						const open = isRecord(candle['open']) ? candle['open'] : {}
						const high = isRecord(candle['high']) ? candle['high'] : {}
						const low = isRecord(candle['low']) ? candle['low'] : {}
						const close = isRecord(candle['close']) ? candle['close'] : {}
						return operationRow(
							new Date(Number(candle['bucketStart'] ?? 0) * 1_000).toLocaleString(),
							`O ${context.operationRatio(open['numerator'], open['denominator'])} · H ${context.operationRatio(high['numerator'], high['denominator'])} · L ${context.operationRatio(low['numerator'], low['denominator'])} · C ${context.operationRatio(close['numerator'], close['denominator'])}`,
							`${String(candle['observations'] ?? '0')} observations`,
							undefined,
						)
					}),
					'No reserve observations are available for candles.',
				),
			)
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
					const paginationContext = context.captureOperationsRenderContext()
					loadMore.disabled = true
					loadMore.setAttribute('aria-busy', 'true')
					loadMoreStatus.textContent = 'Loading older coordinator decisions…'
					const loaded = await context.loadOperations({
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
			loadedRiskHistoryOffset = context.operationsHistoryOffset(history['loadedOffset']) ?? context.operationsHistoryOffset(history['offset']) ?? 0
			const historyCollections = Object.fromEntries(context.operationsRiskHistoryKeys.map(key => [key, operationRecords(history[key])]))
			for (const [key, label] of [
				['stateSnapshots', 'Tagged risk history'],
				['accountingSnapshots', 'Accounting checkpoint history'],
				['lifecycleEvents', 'Risk lifecycle events'],
				['liquidations', 'Liquidation history'],
			] as const) {
				const records = historyCollections[key] ?? []
				panels.push(operationsPanel(label, detailEvidenceRows(records), `No ${label.toLowerCase()} available in this view.`))
			}
			const historySummary = summarizeHistoryCollections(historyCollections, context.operationsRiskHistoryKeys)
			const historyBlockRange = historyBlockRangeLabel(historySummary.oldestBlock, historySummary.newestBlock)
			const historyCounts = [`tagged state ${historySummary.counts['stateSnapshots'] ?? 0}`, `accounting ${historySummary.counts['accountingSnapshots'] ?? 0}`, `lifecycle ${historySummary.counts['lifecycleEvents'] ?? 0}`, `liquidations ${historySummary.counts['liquidations'] ?? 0}`].join(' · ')
			const nextHistoryCursor = history['nextCursor']
			if (history['truncated'] === true && typeof nextHistoryCursor !== 'string') throw new Error('Risk history continuation is malformed')
			if (history['truncated'] === true && typeof nextHistoryCursor === 'string') {
				const nextHistoryOffset = loadedRiskHistoryOffset + (context.operationsHistoryOffset(history['limit']) ?? 100)
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
					const paginationContext = context.captureOperationsRenderContext()
					loadMore.disabled = true
					loadMore.setAttribute('aria-busy', 'true')
					loadMoreStatus.textContent = 'Loading older pool and vault evidence…'
					recordPaginationLayout()
					const loaded = await context.loadOperations({
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
				if (context.isDemo && context.pageUrl.searchParams.get('riskHistoryAutoLoad') === '1' && !context.demoRiskHistoryAutoLoadConsumed) {
					context.demoRiskHistoryAutoLoadConsumed = true
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

		const demand = operationRecords(data['demandCurve'])
		if (demand.length > 0) {
			const demandRows = demand.map(point => operationRow(`Tick ${String(point['tick'])}`, `${operationNumber(point['amountAttoEth'])} attoETH · cumulative ${operationNumber(point['cumulativeDemandAttoEth'])}`, String(point['tick']), undefined))
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
							`${exactUnit(String(forkSummary['migrated_atto_rep'] ?? '0'), 18, 'REP', 4)} migrated · ${exactUnit(String(forkSummary['burned_atto_rep'] ?? '0'), 18, 'REP', 4)} burned`,
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
					branches.map(branch => operationRow(`Child ${String(branch['child_universe_id'])}`, `Outcome ${String(branch['outcome_index'] ?? '—')} · ${operationNumber(branch['migrated_atto_rep'])} attoREP · ${operationCounted(branch['migrator_count'], 'migrator')}`, String(branch['child_universe_id']), undefined)),
					'No child branches match this view.',
				),
			)
		const evidencePage = context.detailPageRecord(data, route.kind === 'report' ? 'rounds' : 'events')
		const evidenceItems = operationRecords(evidencePage['items'])
		context.operationsDetailState = {
			chainId: context.requiredChainId(),
			routeKey: context.operationsDetailRouteKey(route),
			items: evidenceItems,
			decisionItems,
			riskHistoryOffset: loadedRiskHistoryOffset,
		}
		const evidenceHasMore = evidencePage['hasMore'] === true && typeof evidencePage['nextCursor'] === 'string'
		if (operationsDetailEvidencePanelVisible(route.kind, evidenceItems.length, evidenceHasMore, renderContext.focusLoadMore)) {
			const evidencePanel = operationsPanel(route.kind === 'report' ? 'Report rounds' : 'Lifecycle timeline', context.detailEvidenceRowsFor(route.kind, evidenceItems), 'No canonical evidence is available.')
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
					const paginationContext = context.captureOperationsRenderContext()
					loadMore.disabled = true
					loadMore.setAttribute('aria-busy', 'true')
					loadMoreStatus.textContent = 'Loading older canonical evidence…'
					const loaded = await context.loadOperations({
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
		grid.append(...panels)
		content.replaceChildren(header, summary, grid)
		content.setAttribute('aria-busy', 'false')
		$('#operations-status').hidden = true
		context.restoreOperationsRenderContext(renderContext)
	}
	return { tradingEvidenceRows, reportEvidenceRows, detailEvidenceRows, renderOperationsDetail }
}
