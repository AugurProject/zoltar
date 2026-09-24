import { semanticSummary } from './semantic-evidence.ts'
import type { OperationsCatalogSection, OperationsDetailRoute, OperationsRenderContext } from './browser-types.ts'
import { approvalTransitionFields } from './live-update.ts'
import { isRecord, operationRecords, type JsonRecord } from './api-validation.ts'
import { exactUnit } from './format.ts'
import { shortIdentifier } from './identifier-format.ts'
import { canonicalOperationsPath, parseOperationsDetailRoute } from './routes.ts'
import { renderOperationsRiskSnapshotFilter, renderOperationsTimelineFilters, type createOperationsComponents } from './operations-components.ts'

interface OperationsRouteViewDeps {
	lookup: (selector: string) => HTMLElement
	getPageUrl: () => URL
	selectedChainId: () => string
	requiredChainId: () => string
	isDemo: boolean
	element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	number: (value: string | number | bigint | null | undefined) => string
	counted: (value: string | number | bigint | null | undefined, singular: string, plural?: string) => string
	operationRow: ReturnType<typeof createOperationsComponents>['operationRow']
}

export const createOperationsRouteView = (deps: OperationsRouteViewDeps) => {
	const { selectedChainId, requiredChainId, isDemo, element, number, counted, operationRow } = deps
	const $ = deps.lookup
	const pageUrl = deps.getPageUrl
	const operationsCatalogSection = (): OperationsCatalogSection | undefined => {
		const section = location.pathname.split('/')[2]
		return section === 'reports' || section === 'escalations' || section === 'auctions' || section === 'forks' || section === 'trading' || section === 'timeline' || section === 'integrity' || section === 'risk' ? section : undefined
	}

	const approvalTransitionSummary = (item: Readonly<Record<string, unknown>>): string => {
		const eventData = isRecord(item['event_data']) ? item['event_data'] : {}
		const receiver = String(item['receiver_vault'] ?? eventData['receiverVault'] ?? '')
		const operation = typeof eventData['operationId'] === 'string' ? `operation ${shortIdentifier(eventData['operationId'])}` : undefined
		const fields = approvalTransitionFields(eventData).map(field => `${field.label} ${operationNumber(field.value)}${field.unit === '' ? '' : ` ${field.unit}`}`)
		const details = [operation, ...fields, receiver === '' ? undefined : `receiver ${shortIdentifier(receiver, 10, 6)}`].filter((value): value is string => value !== undefined)
		return details.length === 0 ? 'Authorization lifecycle transition' : details.join(' · ')
	}

	const captureOperationsRenderContext = (): OperationsRenderContext => {
		const content = $('#operations-content')
		const active = document.activeElement
		return {
			...(active instanceof HTMLAnchorElement && content.contains(active) ? { focusHref: active.href } : {}),
			focusLoadMore: active instanceof HTMLElement && (active.classList.contains('operations-catalog-more') || active.classList.contains('operations-detail-more') || active.classList.contains('operations-pagination-complete')),
			...(active instanceof HTMLElement && (active.dataset['detailCollection'] === 'decisions' || active.dataset['detailCollection'] === 'evidence') ? { focusDetailCollection: active.dataset['detailCollection'] } : {}),
			...(active instanceof HTMLElement && (active.dataset['riskKind'] === 'pool' || active.dataset['riskKind'] === 'vault') ? { focusRiskKind: active.dataset['riskKind'] } : {}),
			focusHistoryMore: active instanceof HTMLElement && (active.classList.contains('operations-history-more') || active.classList.contains('operations-history-complete')),
			...(active instanceof HTMLElement && content.contains(active) ? { focusViewportTop: active.getBoundingClientRect().top } : {}),
			scrollY: window.scrollY,
		}
	}

	const restoreOperationsRenderContext = (snapshot: OperationsRenderContext) => {
		const content = $('#operations-content')
		const continuation = snapshot.focusDetailCollection === undefined ? content.querySelector<HTMLButtonElement>('.operations-catalog-more, .operations-detail-more') : content.querySelector<HTMLButtonElement>(`[data-detail-collection="${snapshot.focusDetailCollection}"]`)
		const completion = content.querySelector<HTMLElement>('.operations-pagination-complete')
		const historyContinuation = content.querySelector<HTMLButtonElement>('.operations-history-more')
		const historyCompletion = content.querySelector<HTMLElement>('.operations-history-complete')
		const catalogRows = [...content.querySelectorAll<HTMLAnchorElement>('a.operations-row')]
		const riskTarget = snapshot.focusRiskKind === undefined ? undefined : content.querySelector<HTMLElement>(`[data-risk-kind="${snapshot.focusRiskKind}"]`)
		const focusTarget = () => {
			if (snapshot.focusHref !== undefined) return catalogRows.find(candidate => candidate.href === snapshot.focusHref)
			if (snapshot.focusHistoryMore) return historyContinuation ?? historyCompletion
			return snapshot.focusLoadMore ? (continuation ?? completion ?? catalogRows.at(-1)) : undefined
		}
		const target = riskTarget ?? focusTarget()
		window.scrollTo({ top: snapshot.scrollY, behavior: 'auto' })
		if (target === undefined || target === null) return
		target.focus({ preventScroll: true })
		if (snapshot.focusViewportTop !== undefined) {
			window.scrollBy({ top: target.getBoundingClientRect().top - snapshot.focusViewportTop, behavior: 'auto' })
			target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
		}
	}

	const operationNumber = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? number(value) : number(undefined))

	const operationCounted = (value: unknown, singular: string, plural?: string): string => (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? counted(value, singular, plural) : counted(undefined, singular, plural))

	const operationRatio = (numerator: unknown, denominator: unknown, maximumFraction = 4): string => {
		if (typeof numerator !== 'string' || typeof denominator !== 'string' || !/^\d+$/.test(numerator) || !/^\d+$/.test(denominator) || denominator === '0') return 'Unavailable'
		const scale = 10n ** BigInt(maximumFraction)
		return exactUnit((BigInt(numerator) * scale) / BigInt(denominator), maximumFraction, '')
	}

	const operationsHref = (pathname: string): string => {
		const destination = new URL(pathname, location.origin)
		destination.pathname = canonicalOperationsPath(destination.pathname)
		const chainId = selectedChainId()
		if (chainId !== '') destination.searchParams.set('chainId', chainId)
		if (isDemo) destination.searchParams.set('demo', '1')
		const atBlock = pageUrl().searchParams.get('atBlock')
		if (atBlock !== null && (destination.pathname.startsWith('/operations/risk') || destination.pathname.startsWith('/pool/') || destination.pathname.startsWith('/vault/'))) destination.searchParams.set('atBlock', atBlock)
		return `${destination.pathname}${destination.search}`
	}

	const operationsTimelineFilters = (): HTMLFormElement => renderOperationsTimelineFilters(pageUrl(), requiredChainId(), isDemo, operationsHref)

	const operationsRiskSnapshotFilter = (): HTMLFormElement => renderOperationsRiskSnapshotFilter(pageUrl(), requiredChainId(), isDemo, operationsHref)

	const operationsDetailRoute = (): OperationsDetailRoute | undefined => parseOperationsDetailRoute(location.pathname)

	const operationsSectionFilters = (selected: string): HTMLElement[] => {
		if (selected === 'timeline') return [operationsTimelineFilters()]
		return selected === 'risk' ? [operationsRiskSnapshotFilter()] : []
	}

	const historyBlockRangeLabel = (oldestBlock: bigint | undefined, newestBlock: bigint | undefined, emptyLabel = 'No block-numbered evidence is loaded') => {
		if (oldestBlock === undefined || newestBlock === undefined) return emptyLabel
		if (oldestBlock === newestBlock) return `Loaded block #${oldestBlock.toLocaleString('en-US')}`
		return `Loaded blocks #${oldestBlock.toLocaleString('en-US')}–#${newestBlock.toLocaleString('en-US')}`
	}

	const operationsDetailRouteKey = (route: OperationsDetailRoute): string => `${route.kind}:${route.identity.join(':').toLowerCase()}`

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
			const row = operationRow(eventName, semanticSummary(item), String(item['tx_hash'] ?? ''), block)
			row.append(rawEvidence(item))
			return row
		})

	const tradingEvidenceRows = (items: readonly JsonRecord[]) =>
		items.map(item => {
			const eventName = String(item['event_name'] ?? 'AMM event')
			const data = isRecord(item['event_data']) ? item['event_data'] : {}
			const analytics = isRecord(item['analytics']) ? item['analytics'] : {}
			let summary = semanticSummary(item)
			if (eventName === 'Swap')
				summary = `${String(analytics['direction'] ?? 'Swap')} · ${exactUnit(String(analytics['amountIn'] ?? '0'), 18, String(analytics['baseAsset'] ?? 'shares'))} in → ${exactUnit(String(analytics['amountOut'] ?? '0'), 18, String(analytics['quoteAsset'] ?? 'shares'))} out · ${exactUnit(String(analytics['feeAmount'] ?? '0'), 18, 'shares')} fee${isRecord(analytics['priceImpact']) && analytics['priceImpact']['bps'] !== undefined ? ` · ${exactUnit(String(analytics['priceImpact']['bps']), 2, '%')} impact` : ''}`
			else if (eventName === 'Sync') summary = `${exactUnit(String(data['yesReserve'] ?? '0'), 18, 'YES')} · ${exactUnit(String(data['noReserve'] ?? '0'), 18, 'NO')} reserves`
			else if (eventName === 'Transfer') summary = `${exactUnit(String(data['amount'] ?? '0'), 18, 'LP shares')} · ${shortIdentifier(String(data['from'] ?? ''))} → ${shortIdentifier(String(data['to'] ?? ''))}`
			else if (eventName === 'Approval') summary = `${exactUnit(String(data['amount'] ?? '0'), 18, 'LP shares')} · ${shortIdentifier(String(data['owner'] ?? ''))} approved ${shortIdentifier(String(data['spender'] ?? ''))}`
			else if (eventName.startsWith('Liquidity')) summary = `${exactUnit(String(data['yesAmount'] ?? '0'), 18, 'YES')} · ${exactUnit(String(data['noAmount'] ?? '0'), 18, 'NO')} · ${exactUnit(String(data['liquidity'] ?? '0'), 18, 'LP shares')}`
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

	const detailEvidenceRowsFor = (kind: OperationsDetailRoute['kind'], items: readonly JsonRecord[]) => {
		if (kind === 'trading') return tradingEvidenceRows(items)
		return kind === 'report' ? reportEvidenceRows(items) : detailEvidenceRows(items)
	}

	return {
		operationsCatalogSection,
		approvalTransitionSummary,
		captureOperationsRenderContext,
		restoreOperationsRenderContext,
		operationNumber,
		operationCounted,
		operationRatio,
		operationsHref,
		operationsTimelineFilters,
		operationsRiskSnapshotFilter,
		operationsDetailRoute,
		operationsSectionFilters,
		historyBlockRangeLabel,
		operationsDetailRouteKey,
		rawEvidence,
		detailEvidenceRows,
		detailEvidenceRowsFor,
	}
}
