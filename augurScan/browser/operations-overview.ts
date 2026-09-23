import { shortIdentifier } from './identifier-format.ts'
import type { NetworkRecord, OperationsCatalogSection, OperationsRenderContext, PagedOperationsCatalogSection } from './browser-types.ts'
import { isRecord, operationRecords, operationsCatalogRecords, operationsRiskPagination, operationsRiskRecords, type JsonRecord, type OperationsResponse } from './api-validation.ts'
import { compareCanonicalEventPosition, evidenceStatusLabel, historyInvalidationEvidencePresentation, historyInvalidationReasonLabel, operationsForkChildCount, operationsRiskPresentation, operationsRouteFreshness, timelineEntityTypeLabel, timelineOccurrenceFields } from './live-update.ts'
import { exactUnit, percentFromBps } from './format.ts'
import type { createOperationsComponents } from './operations-components.ts'

type Components = ReturnType<typeof createOperationsComponents>

export interface OperationsOverviewDeps {
	readonly lookup: (selector: string) => HTMLElement
	readonly captureContext: () => OperationsRenderContext
	readonly restoreContext: (context: OperationsRenderContext) => void
	readonly networks: readonly NetworkRecord[]
	readonly requiredChainId: () => string
	readonly element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	readonly number: (value: string | number | bigint | null | undefined) => string
	readonly exactTimestamp: (value: string | number | Date | null | undefined) => string
	readonly counted: (value: string | number | bigint | null | undefined, singular: string, plural?: string) => string
	readonly operationNumber: (value: unknown) => string
	readonly operationCounted: (value: unknown, singular: string, plural?: string) => string
	readonly operationsHref: (pathname: string) => string
	readonly approvalTransitionSummary: (item: Readonly<Record<string, unknown>>) => string
	readonly operationsCatalogSection: () => OperationsCatalogSection | undefined
	readonly operationsSectionFilters: (selected: string) => HTMLElement[]
	readonly connection: HTMLElement
	readonly setRiskCatalogState: (state: { readonly chainId: string; readonly pools: readonly JsonRecord[]; readonly vaults: readonly JsonRecord[] }) => void
	readonly setCatalogState: (state: { readonly chainId: string; readonly section: PagedOperationsCatalogSection; readonly items: readonly JsonRecord[] }) => void
	readonly loadOperations: (options?: { live?: boolean; catalogTargetCount?: number; riskPoolTargetCount?: number; riskVaultTargetCount?: number; detailTargetCount?: number; decisionTargetCount?: number; historyTargetOffset?: number; preservedContext?: OperationsRenderContext }) => Promise<boolean>
	readonly components: Components
}

export const renderOperationsOverview = (deps: OperationsOverviewDeps, response: OperationsResponse, preservedContext?: OperationsRenderContext) => {
	const {
		lookup: $,
		captureContext: captureOperationsRenderContext,
		restoreContext: restoreOperationsRenderContext,
		networks: latestNetworks,
		requiredChainId,
		element,
		number,
		exactTimestamp,
		counted,
		operationNumber,
		operationCounted,
		operationsHref,
		approvalTransitionSummary,
		operationsCatalogSection,
		operationsSectionFilters,
		connection,
		loadOperations,
	} = deps
	const { operationCard, operationRow, exactEvidenceRow, operationsPanel } = deps.components
	const content = $('#operations-content')
	const renderContext = preservedContext ?? captureOperationsRenderContext()
	const { asOf, data } = response
	const selected = location.pathname.split('/')[2] ?? 'overview'
	const reports = operationsCatalogRecords('reports', data['reports'])
	const escalations = operationsCatalogRecords('escalations', data['escalations'])
	const auctions = operationsCatalogRecords('auctions', data['auctions'])
	const forks = operationsCatalogRecords('forks', data['forks'])
	const changes = operationRecords(data['recentChanges'])
	const prices = operationRecords(data['prices'])
	const trading = operationsCatalogRecords('trading', data['trading'])
	const timeline = operationsCatalogRecords('timeline', data['timeline'])
	const integrity = operationsCatalogRecords('integrity', data['integrity'])
	const selectedCatalogPage = isRecord(data['_catalogPage']) ? data['_catalogPage'] : undefined
	const totals = isRecord(data['totals']) ? data['totals'] : {}
	const selectedNetwork = latestNetworks.find(network => String(network.chain_id) === requiredChainId())
	const selectedNetworkScope = `Selected network · ${selectedNetwork?.name ?? `chain ${requiredChainId()}`} · chain ${requiredChainId()}`
	const riskValue = data['risk']
	const historical = asOf['historical'] === true || asOf['phase'] === 'historical'
	if (riskValue !== undefined && !isRecord(riskValue)) throw new Error('Operations risk is malformed')
	const risk = isRecord(riskValue) ? riskValue : {}
	const riskPagination = operationsRiskPagination(risk['pagination'], riskValue !== undefined)
	const pools = operationsRiskRecords('pools', risk['pools'])
	const vaults = operationsRiskRecords('vaults', risk['vaults'])
	const approvals = operationRecords(risk['approvalEvents']).sort(compareCanonicalEventPosition)
	const recentLiquidations = operationRecords(risk['recentLiquidations'])
	const freshness = element('div', 'operations-freshness')
	freshness.append(
		operationCard('Latest block', `#${number(typeof asOf['blockNumber'] === 'string' ? asOf['blockNumber'] : undefined)}`, shortIdentifier(String(asOf['blockHash'] ?? 'Unavailable'))),
		operationCard('Observed head', `#${number(typeof asOf['observedHead'] === 'string' ? asOf['observedHead'] : undefined)}`),
		operationCard('Block lag', number(typeof asOf['lagBlocks'] === 'string' ? asOf['lagBlocks'] : undefined), String(asOf['phase'] ?? 'Unavailable')),
		operationCard('Block timestamp', asOf['blockTimestamp'] === undefined ? 'Unavailable' : exactTimestamp(Number(asOf['blockTimestamp']) * 1_000).replace('.000Z', 'Z')),
	)
	const metrics = element('div', 'operations-metrics')
	metrics.append(
		operationCard(
			'OpenOracle reports',
			operationNumber(totals['reports'] ?? reports.length),
			counted(reports.filter(item => isRecord(item['lifecycle']) && item['lifecycle']['state'] === 'Settleable').length, 'settleable'),
			changes.filter(item => item['entity_type'] === 'report'),
		),
		operationCard(
			'Escalation games',
			operationNumber(totals['escalations'] ?? escalations.length),
			undefined,
			changes.filter(item => item['entity_type'] === 'escalation'),
		),
		operationCard(
			'Truth auctions',
			operationNumber(totals['auctions'] ?? auctions.length),
			counted(auctions.filter(item => item['status'] === 'Open').length, 'open'),
			changes.filter(item => item['entity_type'] === 'auction'),
		),
		operationCard(
			'Pool / vault snapshots',
			`${operationNumber(totals['pools'] ?? pools.length)} / ${operationNumber(totals['vaults'] ?? vaults.length)}`,
			undefined,
			changes.filter(item => item['entity_type'] === 'pool' || item['entity_type'] === 'vault'),
		),
	)
	const reportRows = reports.map(item => {
		const lifecycle = isRecord(item['lifecycle']) ? item['lifecycle'] : {}
		const reportData = isRecord(item['report_data']) ? item['report_data'] : {}
		return operationRow(
			`Report ${String(item['report_id'] ?? '—')}`,
			`${String(lifecycle['state'] ?? 'Awaiting indexed evidence')} · ${operationCounted(item['observed_rounds'], 'round')} · ${String(reportData['token1'] ?? 'token 1')} / ${String(reportData['token2'] ?? 'token 2')}`,
			`${String(item['open_oracle_address'] ?? '')}:${String(item['report_id'] ?? '')}`,
			item['block_number'],
			operationsHref(`/operations/report/${encodeURIComponent(String(item['open_oracle_address'] ?? ''))}/${encodeURIComponent(String(item['report_id'] ?? ''))}`),
		)
	})
	const escalationRows = escalations.map(item =>
		operationRow(
			'Escalation game',
			`${String(item['event_name'] ?? 'Active')} · INVALID ${exactUnit(String(item['invalid_stake_atto_rep'] ?? '0'), 18, 'REP')} · NO ${exactUnit(String(item['no_stake_atto_rep'] ?? '0'), 18, 'REP')} · YES ${exactUnit(String(item['yes_stake_atto_rep'] ?? '0'), 18, 'REP')}`,
			String(item['game_address'] ?? ''),
			item['block_number'],
			operationsHref(`/operations/escalation/${encodeURIComponent(String(item['game_address'] ?? ''))}`),
		),
	)
	const auctionRows = auctions.map(item =>
		operationRow(
			'Truth auction',
			`${String(item['status'] ?? 'Awaiting indexed evidence')} · ${operationCounted(item['bid_count'], 'bid')} · ${operationCounted(item['bidder_count'], 'bidder')}`,
			String(item['auction_address'] ?? ''),
			item['block_number'],
			operationsHref(`/operations/auction/${encodeURIComponent(String(item['auction_address'] ?? ''))}`),
		),
	)
	const poolRiskRows = pools.map(item => {
		const capacity = isRecord(item['capacity']) ? item['capacity'] : {}
		const riskPresentation = operationsRiskPresentation('pool', item['protocol_state'], item['scanner_severity'])
		return operationRow(
			'Pool accounting',
			`${riskPresentation.scannerAssessment} · ${percentFromBps(operationNumber(capacity['utilizationBps']))} utilized · ${String(item['scanner_reason'] ?? '')}`,
			String(item['pool_address'] ?? ''),
			item['block_number'],
			operationsHref(`/operations/risk/pool/${encodeURIComponent(String(item['pool_address'] ?? ''))}`),
		)
	})
	const vaultRiskRows = vaults.map(item => {
		const itemRisk = isRecord(item['risk']) ? item['risk'] : {}
		const riskPresentation = operationsRiskPresentation('vault', item['protocol_state'], item['scanner_severity'])
		return operationRow(
			'Vault position',
			`${riskPresentation.scannerAssessment} · health ${percentFromBps(operationNumber(itemRisk['healthFactorBps']))} · ${String(item['scanner_reason'] ?? '')}`,
			String(item['vault_address'] ?? ''),
			item['block_number'],
			operationsHref(`/operations/risk/vault/${encodeURIComponent(String(item['pool_address'] ?? ''))}/${encodeURIComponent(String(item['vault_address'] ?? ''))}`),
		)
	})
	const riskRows = [...poolRiskRows, ...vaultRiskRows]
	const approvalRows = approvals.map(item => operationRow(String(item['event_name'] ?? 'Liquidation approval'), approvalTransitionSummary(item), String(item['approval_identity'] ?? item['receiver_vault'] ?? ''), item['block_number']))
	const liquidationRows = recentLiquidations.map(item => operationRow('Vault liquidation', 'Canonical liquidation route and resulting debt evidence', String(item['entity_identity'] ?? item['source_contract'] ?? ''), item['block_number']))
	const tradingRows = trading.map(item =>
		operationRow(
			String(item['question_title'] ?? 'Augur AMM market'),
			`${item['conditional_yes_bps'] === null || item['conditional_yes_bps'] === undefined ? 'No reserve price' : `${exactUnit(String(item['conditional_yes_bps']), 2, '%')} YES`} · ${operationCounted(item['swap_count'], 'swap')} · ${operationCounted(item['lp_holder_count'], 'LP participant')}`,
			String(item['pair_address'] ?? ''),
			item['price_block_number'],
			operationsHref(`/operations/trading/${encodeURIComponent(String(item['pair_address'] ?? ''))}`),
		),
	)
	const timelineRows = timeline.map(item => {
		const rawEvidenceStatus = item['evidence_status'] ?? (item['canonical'] === false ? 'noncanonical' : 'canonical')
		const invalidation = item['invalidation_reason'] === undefined ? '' : ` · ${historyInvalidationReasonLabel(item['invalidation_reason'])}`
		return exactEvidenceRow(String(item['semantic_event_kind'] ?? 'Protocol transition'), `${timelineEntityTypeLabel(item['entity_type'])} · ${evidenceStatusLabel(rawEvidenceStatus)}${invalidation}`, [
			...timelineOccurrenceFields(item),
			['Evidence status code', rawEvidenceStatus],
			['Invalidation reason code', item['invalidation_reason']],
		])
	})
	const integrityRows = integrity.map(item => {
		const evidence = historyInvalidationEvidencePresentation(item['causes'], item['occurrence_counts'])
		const primaryReason = String(item['reason'] ?? '')
		const primaryReasonLabel = historyInvalidationReasonLabel(primaryReason)
		const causeSummary = evidence.causeCodes.length === 1 && evidence.causeCodes[0] === primaryReason ? '' : ` · ${evidence.causeLabel}`
		return exactEvidenceRow(
			primaryReasonLabel,
			`${operationCounted(item['depth'], 'replaced block')} · ${operationCounted(evidence.occurrenceTotal, 'affected occurrence')}${causeSummary}`,
			[
				['Primary invalidation reason code', item['reason']],
				['Complete cause set', evidence.causeCodes.join(', ')],
				...evidence.occurrenceFields,
				['Invalidating indexer run', item['indexer_run_id']],
				['Invalidating ABI source hash', item['abi_source_hash']],
				['Invalidating application source hash', item['application_source_hash']],
				['Invalidating projection source hash', item['projection_source_hash']],
				['Previous block hash', item['previous_hash']],
				['Ancestor block hash', item['ancestor_hash']],
				['Detected at', item['detected_at']],
			],
			item['previous_block'],
		)
	})
	const forkRows = forks.map(item =>
		operationRow(
			`Universe ${String(item['universe_identity'] ?? '—')} fork`,
			`${operationsForkChildCount(operationNumber(item['child_count']), item['child_count'])} · ${operationCounted(item['migrator_count'], 'migrator')} · ${exactUnit(String(item['migrated_atto_rep'] ?? '0'), 18, 'REP')} migrated · ${operationCounted(item['obligation_events'], 'escalation obligation')}`,
			undefined,
			item['block_number'],
			operationsHref(`/operations/fork/${encodeURIComponent(String(item['universe_identity'] ?? ''))}`),
		),
	)
	const changeRows = changes.map(item => operationRow(String(item['semantic_event_kind'] ?? 'Protocol transition'), 'Canonical semantic evidence', String(item['entity_identity'] ?? ''), item['block_number']))
	const priceRows = prices.map(item => operationRow('Coordinator REP / ETH', `${exactUnit(operationNumber(item['value']), 18, 'REP/ETH')} · ${String(item['source_event'] ?? 'Unavailable')}`, String(item['source_contract'] ?? ''), item['block_number']))
	const attentionReportRows: HTMLElement[] = []
	for (const [index, item] of reports.entries()) {
		const lifecycle = isRecord(item['lifecycle']) ? item['lifecycle'] : {}
		const row = reportRows[index]
		if ((lifecycle['state'] === 'Dispute window open' || lifecycle['state'] === 'Settleable') && row !== undefined) attentionReportRows.push(row)
	}
	const concludedEscalationEvents = new Set(['NonDecisionReached', 'GameContinuedFromFork', 'InheritedThresholdTie'])
	const activeEscalationRows: HTMLElement[] = []
	for (const [index, item] of escalations.entries()) {
		const row = escalationRows[index]
		if (!concludedEscalationEvents.has(String(item['event_name'] ?? '')) && row !== undefined) activeEscalationRows.push(row)
	}
	const activeAuctionRows: HTMLElement[] = []
	for (const [index, item] of auctions.entries()) {
		const row = auctionRows[index]
		if (['Open', 'Awaiting finalization', 'Bid settlements outstanding'].includes(String(item['status'] ?? '')) && row !== undefined) activeAuctionRows.push(row)
	}
	const riskPoolPanel = operationsPanel('Pool risk evidence', poolRiskRows, 'No pool accounting snapshots match this view.', {
		label: `${operationCounted(pools.length, 'pool')} shown · ${operationCounted(riskPagination['poolTotal'], 'pool')} total`,
	})
	const riskVaultPanel = operationsPanel('Vault risk evidence', vaultRiskRows, 'No vault accounting snapshots match this view.', {
		label: `${operationCounted(vaults.length, 'vault')} shown · ${operationCounted(riskPagination['vaultTotal'], 'vault')} total`,
	})
	const sectionPanels = new Map<string, () => HTMLElement[]>([
		['reports', () => [operationsPanel('OpenOracle reports', reportRows, 'No reports match this view.')]],
		['escalations', () => [operationsPanel('Escalation games', escalationRows, 'No escalation games match this view.')]],
		['auctions', () => [operationsPanel('Truth auctions', auctionRows, 'No auctions match this view.')]],
		['risk', () => [riskPoolPanel, riskVaultPanel, operationsPanel('Liquidation approval lifecycle', approvalRows, 'No liquidation approvals match this view.'), operationsPanel('Recent liquidations', liquidationRows, 'No vault liquidations match this view.')]],
		['trading', () => [operationsPanel('Augur AMM markets', tradingRows, 'No Augur AMM markets match this view.')]],
		[
			'timeline',
			() => [
				operationsPanel('Cross-protocol historical timeline', timelineRows, 'No semantic evidence matches these filters.', {
					label: `${operationCounted(selectedCatalogPage?.['total'], 'matching transition')} · canonical status and invalidation provenance included`,
				}),
			],
		],
		[
			'forks',
			() => [
				operationsPanel('Zoltar forks and migration progress', forkRows, 'No universe forks match this view.', {
					label: `${operationCounted(forkRows.length, 'fork')} shown · ${operationCounted(selectedCatalogPage?.['total'], 'fork')} total`,
				}),
			],
		],
		[
			'integrity',
			() => [
				operationsPanel('Selected-chain replacements', integrityRows, 'No chain reorganizations have been recorded.', {
					label: selectedNetworkScope,
				}),
				operationsPanel(
					'Scanner-wide schema migration history',
					operationRecords(data['migrations']).map(item => exactEvidenceRow(`Schema ${String(item['schema_version'] ?? '')}`, String(item['description'] ?? ''), [['Applied at', item['applied_at']]])),
					'No migration records are available.',
					{ label: 'Scanner-wide · all configured networks', scannerWide: true },
				),
				operationsPanel(
					'Scanner-wide indexer provenance',
					operationRecords(data['runs']).map(item =>
						exactEvidenceRow(`augurScan ${String(item['app_version'] ?? '')}`, `Schema ${String(item['schema_version'] ?? '')} · process run ${String(item['id'] ?? 'not recorded')}`, [
							['ABI source hash', item['abi_source_hash']],
							['Application source hash', item['application_source_hash']],
							['Projection source hash', item['projection_source_hash']],
							['Indexer enabled', item['indexer_enabled']],
							['Started at', item['started_at']],
							['Stopped at', item['stopped_at']],
						]),
					),
					'No indexer-run provenance is available.',
					{ label: 'Scanner-wide · latest 25 process runs across all networks', scannerWide: true },
				),
				operationsPanel(
					'Selected-chain historical exports',
					[
						operationRow('Export semantic timeline', 'Snapshot-bound canonical NDJSON with exact event data; response headers identify an opaque continuation cursor.', undefined, undefined, operationsHref('/api/v1/export?dataset=timeline&canonical=canonical&limit=50000')),
						operationRow('Export canonical and orphan logs', 'Occurrence-level NDJSON including decoded arguments and canonical flags.', undefined, undefined, operationsHref('/api/v1/export?dataset=logs&canonical=all&limit=50000')),
					],
					'',
					{ label: selectedNetworkScope },
				),
			],
		],
	])
	const panels = sectionPanels.get(selected)?.() ?? [
		operationsPanel('Needs attention · reports', attentionReportRows.slice(0, 5), 'No reports need attention.'),
		operationsPanel('Active escalations', activeEscalationRows, 'No escalation games are active.'),
		operationsPanel('Active auctions', activeAuctionRows, 'No auctions are active.'),
		operationsPanel('Pool and vault risk', riskRows, 'No risk snapshots are available.'),
		operationsPanel('Fork and migration progress', forkRows, 'No forks or migrations match this view.'),
		operationsPanel('Price provenance', priceRows, 'No accepted coordinator price is available.'),
		operationsPanel('Recent semantic changes', changeRows, 'No changes match this view.'),
	]
	const grid = element('div', panels.length === 1 ? 'operations-grid operations-grid-single' : 'operations-grid')
	grid.append(...panels)
	const riskCatalogPage = isRecord(data['_riskCatalogPage']) ? data['_riskCatalogPage'] : undefined
	if (selected === 'risk' && riskCatalogPage !== undefined) {
		deps.setRiskCatalogState({ chainId: requiredChainId(), pools, vaults })
		const appendRiskPagination = (kind: 'pool' | 'vault', panel: HTMLElement, loadedCount: number, hasMore: boolean, nextCursor: unknown) => {
			if (hasMore && typeof nextCursor === 'string') {
				const button = element('button', 'secondary operations-catalog-more', `Show more ${kind === 'pool' ? 'pools' : 'vaults'}`)
				button.type = 'button'
				button.dataset['riskKind'] = kind
				button.setAttribute('aria-label', `Show more ${kind} risk records`)
				const status = element('p', 'activity-summary')
				status.setAttribute('role', 'status')
				status.setAttribute('aria-live', 'polite')
				button.addEventListener('click', async () => {
					const paginationContext = captureOperationsRenderContext()
					button.disabled = true
					button.setAttribute('aria-busy', 'true')
					button.textContent = `Showing more ${kind === 'pool' ? 'pools' : 'vaults'}…`
					status.textContent = `Loading older ${kind} risk records…`
					status.classList.add('sr-only')
					const loaded = await loadOperations({
						live: true,
						...(kind === 'pool' ? { riskPoolTargetCount: loadedCount + 100 } : { riskVaultTargetCount: loadedCount + 100 }),
						preservedContext: paginationContext,
					})
					if (!loaded && button.isConnected) {
						button.disabled = false
						button.removeAttribute('aria-busy')
						button.textContent = `Retry more ${kind === 'pool' ? 'pools' : 'vaults'}`
						status.textContent = `Additional ${kind} risk records could not be loaded.`
						status.classList.remove('sr-only')
						button.focus({ preventScroll: true })
					}
				})
				panel.append(button, status)
			} else if (renderContext.focusRiskKind === kind) {
				const complete = element('p', 'activity-summary operations-pagination-complete', `All available ${kind} records are shown.`)
				complete.dataset['riskKind'] = kind
				complete.tabIndex = -1
				complete.setAttribute('role', 'status')
				complete.setAttribute('aria-live', 'polite')
				panel.append(complete)
			}
		}
		appendRiskPagination('pool', riskPoolPanel, pools.length, riskPagination['poolHasMore'] === true, riskPagination['poolNextCursor'])
		appendRiskPagination('vault', riskVaultPanel, vaults.length, riskPagination['vaultHasMore'] === true, riskPagination['vaultNextCursor'])
	}
	const catalogPage = selectedCatalogPage
	const catalogSection = operationsCatalogSection()
	if (catalogPage !== undefined && catalogSection !== undefined && catalogSection !== 'risk') deps.setCatalogState({ chainId: requiredChainId(), section: catalogSection, items: operationsCatalogRecords(catalogSection, data[catalogSection]) })
	if (catalogPage?.['hasMore'] === true && typeof catalogPage['nextCursor'] === 'string' && selected !== 'overview') {
		const loadMore = document.createElement('button')
		loadMore.type = 'button'
		loadMore.className = 'secondary operations-catalog-more'
		loadMore.textContent = 'Show more records'
		loadMore.setAttribute('aria-label', `Show more ${selected} from older canonical blocks`)
		const loadMoreStatus = element('p', 'activity-summary')
		loadMoreStatus.setAttribute('role', 'status')
		loadMoreStatus.setAttribute('aria-live', 'polite')
		loadMore.addEventListener('click', async () => {
			const paginationContext = captureOperationsRenderContext()
			loadMore.disabled = true
			loadMore.setAttribute('aria-busy', 'true')
			loadMoreStatus.textContent = 'Loading older canonical records…'
			const section = operationsCatalogSection()
			if (section === undefined || section === 'risk') return
			const loaded = await loadOperations({
				live: true,
				catalogTargetCount: operationsCatalogRecords(section, data[section]).length + 100,
				preservedContext: paginationContext,
			})
			if (!loaded && loadMore.isConnected) {
				loadMore.disabled = false
				loadMore.removeAttribute('aria-busy')
				loadMore.textContent = 'Retry older records'
				loadMoreStatus.textContent = 'Older canonical records could not be loaded.'
				loadMore.focus({ preventScroll: true })
			}
		})
		grid.append(loadMore, loadMoreStatus)
	} else if (catalogPage !== undefined && selected !== 'overview' && renderContext.focusLoadMore) {
		const completeStatus = element('p', 'activity-summary', 'All available records are shown.')
		completeStatus.setAttribute('role', 'status')
		completeStatus.setAttribute('aria-live', 'polite')
		grid.append(completeStatus)
	}
	if (selected === 'overview') content.replaceChildren(...(historical ? [freshness] : []), metrics, grid)
	else {
		content.replaceChildren(...(asOf['historical'] === true || asOf['phase'] === 'historical' ? [element('p', 'operations-route-freshness', operationsRouteFreshness(asOf, connection.classList.contains('live')))] : []), ...operationsSectionFilters(selected), grid)
	}
	content.setAttribute('aria-busy', 'false')
	$('#operations-status').hidden = true
	restoreOperationsRenderContext(renderContext)
}
