import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import type { AccountTransaction, EntityHistory, PoolRecord, QuestionRecord, RichListRecord, StateEntity, StateTab, UniverseRecord, VaultRecord } from './browser-types.ts'
import type { ScannerContext } from './app-context.ts'
import { element, lookup } from './app-dom.ts'
import type { OperationsViews } from './app-operations-views.ts'
import { applyLiveChanges, counted, exactTimestamp, liveSnapshot, renderRetryStatus, richListError, setLiveRecord, yesNoCheckpoint } from './app-presentation.ts'
import { renderAddressProfilePage } from './address-profile-page.ts'
import { createAddressProfileRoute } from './address-profile-route.ts'
import { createContractsRoute } from './contracts-route.ts'
import type { DetailViews } from './app-detail-views.ts'
import type { createEvidenceComponents } from './evidence-components.ts'
import { exactNumber, utcDateTime } from './format.ts'
import { isCurrentCanonicalGeneration } from './live-refresh.ts'
import { createRichListRoute } from './rich-list-route.ts'
import { createStateComponents } from './state-components.ts'
import { renderQuestionDetailPage, renderUniverseDetailPage } from './state-entity-pages.ts'
import { createStateHistoryData } from './state-history-data.ts'
import { renderStateHistoryCoverage } from './state-history-coverage.ts'
import { renderPoolDetailPage, renderVaultDetailPage } from './state-risk-pages.ts'
import { createSystemCatalogLoader } from './system-catalog-loader.ts'
import { createSystemRoute } from './system-route.ts'

type EvidenceComponents = ReturnType<typeof createEvidenceComponents>

interface EntityViewDeps {
	readonly evidence: EvidenceComponents
	readonly operations: OperationsViews
	readonly openAccountTransactions: DetailViews['account']['openAccountTransactions']
}

/** Wires the contracts, rich list, address profile, and system-state routes. */
export const createEntityViews = (context: ScannerContext, { evidence, operations, openAccountTransactions }: EntityViewDeps) => {
	const { state, api, requiredChainId, selectedChainId, nativeSymbol, retryCanonicalViewOr } = context
	const { canonicalState, systemRouteState, refreshGates } = state
	const { protocolAddressLink, internalEvidenceLink, decodedArgumentsTable } = evidence
	const { operationsPanel, operationRow } = operations.components
	const { operationCounted, operationsHref, historyBlockRangeLabel } = operations.routeView
	const { staticField, staticAddressField, metricCard, chartNumericValue, chartCard, stateHeader } = createStateComponents(element, protocolAddressLink)

	const contracts = createContractsRoute({
		lookup,
		element,
		internalEvidenceLink,
		number: exactNumber,
		age: context.age,
		exactTimestamp,
		api,
		requiredChainId,
		getViewContextVersion: () => state.viewContextVersion,
		canonicalState,
		refreshGate: refreshGates.contract,
		errorMessage,
		renderRetryStatus,
		retryCanonicalViewOr,
	})

	const richList = createRichListRoute({
		lookup,
		getPageUrl: () => state.pageUrl,
		selectedChainId,
		requiredChainId,
		isDemo: state.isDemo,
		setLiveRecord,
		element,
		protocolAddressLink,
		nativeSymbol,
		number: exactNumber,
		counted,
		openAccountTransactions: item => openAccountTransactions(item),
		canonicalState,
		getViewContextVersion: () => state.viewContextVersion,
		api,
		refreshGate: refreshGates.richList,
		renderRetryStatus,
		richListError,
		errorMessage,
		retryCanonicalViewOr,
	})

	const renderAddressProfile = (item: RichListRecord, transactions: AccountTransaction[], interactions: AccountTransaction[], options: { live?: boolean; portfolioFocusKind?: 'forks' | 'lp' | 'reports' | undefined } = {}) =>
		renderAddressProfilePage(
			{
				lookup,
				liveSnapshot,
				nativeSymbol,
				element,
				isDemo: state.isDemo,
				setLiveRecord,
				number: exactNumber,
				protocolAddressLink,
				operationsPanel,
				operationRow,
				operationCounted,
				operationsHref,
				openAccountTransactions,
				internalEvidenceLink,
				time: utcDateTime,
				decodedArgumentsTable,
				applyLiveChanges,
				loadAddressProfile: options => addressProfile.loadAddressProfile(options),
			},
			item,
			transactions,
			interactions,
			options,
		)

	const addressProfile = createAddressProfileRoute({
		renderAddressProfile,
		lookup,
		element,
		api,
		getPageUrl: () => state.pageUrl,
		getViewContextVersion: () => state.viewContextVersion,
		selectedChainId,
		requiredChainId,
		getNetworks: () => state.networkRenderState.latestNetworks,
		isDemo: state.isDemo,
		canonicalState,
		refreshGate: refreshGates.addressProfile,
		errorMessage,
		retryCanonicalViewOr,
	})

	const { fetchEntityHistory, entityHistoryCollections } = createStateHistoryData(
		path => api(path),
		() => state.pageUrl,
	)

	const historyCoverageNotice = (history: EntityHistory, type: StateTab, item: StateEntity): HTMLElement =>
		renderStateHistoryCoverage(
			{
				lookup,
				element,
				entityHistoryCollections,
				historyBlockRangeLabel,
				number: exactNumber,
				selectEntity: (item, options) => system.selectEntity(item, options),
				isDemo: state.isDemo,
				pageUrl: state.pageUrl,
				demoAutoLoadConsumed: systemRouteState.demoHistoryAutoLoadConsumed,
				consumeDemoAutoLoad: () => {
					systemRouteState.demoHistoryAutoLoadConsumed = true
				},
			},
			history,
			type,
			item,
		)

	const isCurrentDetail = (requestVersion: number, canonicalGeneration: number) => () => requestVersion === systemRouteState.detailRequestVersion && isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)

	const stateRiskDeps = (requestVersion: number, canonicalGeneration: number) => ({
		lookup,
		fetchEntityHistory,
		isCurrent: isCurrentDetail(requestVersion, canonicalGeneration),
		nativeSymbol,
		stateHeader,
		historyCoverageNotice,
		element,
		operationsHref,
		operationsPanel,
		operationRow,
		metricCard,
		number: exactNumber,
		chartCard,
		staticField,
		staticAddressField,
		chartNumericValue,
		yesNoCheckpoint,
	})

	const stateEntityDeps = (requestVersion: number, canonicalGeneration: number) => ({
		lookup,
		fetchEntityHistory,
		isCurrent: isCurrentDetail(requestVersion, canonicalGeneration),
		stateHeader,
		pageUrl: state.pageUrl,
		isDemo: state.isDemo,
		historyCoverageNotice,
		element,
		metricCard,
		number: exactNumber,
		staticField,
		chartCard,
		stateData: systemRouteState.data,
		counted,
		staticAddressField,
	})

	const system = createSystemRoute({
		state: systemRouteState,
		canonicalState,
		lookup,
		element,
		number: exactNumber,
		counted,
		nativeSymbol,
		fetchEntityHistory,
		renderPoolDetail: (poolItem: PoolRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory) => renderPoolDetailPage(stateRiskDeps(requestVersion, canonicalGeneration), poolItem, suppliedHistory),
		renderVaultDetail: (vaultItem: VaultRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory) => renderVaultDetailPage(stateRiskDeps(requestVersion, canonicalGeneration), vaultItem, suppliedHistory),
		renderQuestionDetail: (question: QuestionRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory) => renderQuestionDetailPage(stateEntityDeps(requestVersion, canonicalGeneration), question, suppliedHistory),
		renderUniverseDetail: (universe: UniverseRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory) => renderUniverseDetailPage(stateEntityDeps(requestVersion, canonicalGeneration), universe, suppliedHistory),
		systemDetailRefreshGate: refreshGates.systemDetail,
		liveSnapshot,
		setLiveRecord,
		applyLiveChanges,
		errorMessage,
		retryCanonicalViewOr,
		navigateToCanonicalEntity: (type, item) => {
			const target = new URL(location.href)
			if (type === 'questions' && 'question_id' in item) target.pathname = `/question/${encodeURIComponent(item.question_id)}`
			else if (type === 'universes' && 'universe_id' in item) target.pathname = `/universe/${encodeURIComponent(item.universe_id)}`
			else return
			target.searchParams.delete('tab')
			target.searchParams.delete('entity')
			void context.links.navigateInPlace(target)
		},
	})

	const systemCatalog = createSystemCatalogLoader({
		lookup,
		element,
		api,
		canonicalState,
		getViewContextVersion: () => state.viewContextVersion,
		getStateData: () => systemRouteState.data,
		setStateData: catalog => {
			systemRouteState.data = catalog
		},
		getActiveStateType: () => systemRouteState.activeType,
		getSelectedEntityKey: () => systemRouteState.selectedKey,
		getSelectedEntityHistoryOffset: () => systemRouteState.historyOffset,
		getStateDetailContextVersion: () => systemRouteState.detailContextVersion,
		requiredChainId,
		stateItems: system.stateItems,
		entityKey: system.entityKey,
		fetchEntityHistory,
		systemDetailRefreshGate: refreshGates.systemDetail,
		systemStateRefreshGate: refreshGates.systemState,
		setSystemControlsDisabled: system.setSystemControlsDisabled,
		renderStateStats: system.renderStateStats,
		renderEntityList: system.renderEntityList,
		errorMessage,
		retryCanonicalViewOr,
	})
	document.querySelector<HTMLButtonElement>('#entity-load-more')?.addEventListener('click', () => void systemCatalog.loadMoreSystemState())

	return { contracts, richList, addressProfile, system, systemCatalog }
}
