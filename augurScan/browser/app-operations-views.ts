import type { OperationsResponse } from './api-validation.ts'
import type { OperationsDetailRoute, OperationsRenderContext } from './browser-types.ts'
import type { ScannerContext } from './app-context.ts'
import { element, lookup } from './app-dom.ts'
import { counted, renderRetryStatus } from './app-presentation.ts'
import { exactNumber } from './format.ts'
import { createOperationsComponents } from './operations-components.ts'
import { createOperationsData, operationsHistoryOffset, operationsRiskHistoryKeys } from './operations-data.ts'
import { renderOperationsDetail, showOperationsDetailTab } from './operations-detail.ts'
import { createOperationsLoader } from './operations-loader.ts'
import { renderOperationsOverview } from './operations-overview.ts'
import { operationsRenderSignature } from './operations-render-signature.ts'
import { createOperationsRouteView } from './operations-route-view.ts'

/** Wires the operations overview and detail pages to the shared scanner state. */
export const createOperationsViews = (context: ScannerContext) => {
	const { state, elements, api, requiredChainId, selectedChainId } = context
	const { operationsState } = state
	const operationsData = createOperationsData(
		path => api(path),
		requiredChainId,
		() => state.pageUrl,
	)
	const components = createOperationsComponents()
	const { operationRow } = components
	const routeView = createOperationsRouteView({
		lookup,
		getPageUrl: () => state.pageUrl,
		selectedChainId,
		requiredChainId,
		isDemo: state.isDemo,
		element,
		number: exactNumber,
		counted,
		operationRow,
		navigate: destination => void context.links.navigateInPlace(destination),
	})
	const { captureOperationsRenderContext, restoreOperationsRenderContext, operationNumber, operationCounted, operationsHref, approvalTransitionSummary, operationsCatalogSection, operationsSectionFilters } = routeView

	const renderOperations = (response: OperationsResponse, preservedContext?: OperationsRenderContext, live?: boolean) =>
		renderOperationsOverview(
			{
				lookup,
				captureContext: captureOperationsRenderContext,
				restoreContext: restoreOperationsRenderContext,
				networks: state.networkRenderState.latestNetworks,
				requiredChainId,
				element,
				number: exactNumber,
				operationNumber,
				operationCounted,
				operationsHref,
				approvalTransitionSummary,
				operationsCatalogSection,
				operationsSectionFilters,
				connection: elements.connection,
				setRiskCatalogState: riskCatalogState => {
					operationsState.riskCatalogState = riskCatalogState
				},
				setCatalogState: catalogState => {
					operationsState.catalogState = catalogState
				},
				loadOperations: options => loadOperations(options),
				components,
			},
			response,
			preservedContext,
			live,
		)

	const renderOperationsDetailPage = (response: OperationsResponse, route: OperationsDetailRoute, preservedContext?: OperationsRenderContext, live?: boolean) =>
		renderOperationsDetail(
			{
				lookup,
				captureContext: captureOperationsRenderContext,
				restoreContext: restoreOperationsRenderContext,
				element,
				connection: elements.connection,
				operationsHref,
				approvalTransitionSummary,
				rawEvidence: routeView.rawEvidence,
				operationCounted,
				operationRatio: routeView.operationRatio,
				operationNumber,
				operationsHistoryOffset,
				operationsRiskHistoryKeys,
				detailEvidenceRows: routeView.detailEvidenceRows,
				historyBlockRangeLabel: routeView.historyBlockRangeLabel,
				isDemo: state.isDemo,
				pageUrl: state.pageUrl,
				demoRiskHistoryAutoLoadConsumed: operationsState.demoRiskHistoryAutoLoadConsumed,
				requiredChainId,
				operationsDetailRouteKey: routeView.operationsDetailRouteKey,
				detailEvidenceRowsFor: routeView.detailEvidenceRowsFor,
				consumeDemoRiskHistoryAutoLoad: () => {
					operationsState.demoRiskHistoryAutoLoadConsumed = true
				},
				selectTab: destination => {
					if (destination.href === location.href) return
					history.pushState(null, '', destination)
					state.pageUrl = new URL(location.href)
				},
				setDetailState: detailState => {
					operationsState.detailState = detailState
				},
				loadOperations: options => loadOperations(options),
				components,
			},
			response,
			route,
			preservedContext,
			live,
		)

	const loadOperations = createOperationsLoader({
		state: operationsState,
		requiredChainId,
		lookup,
		api,
		operationsDetailRoute: routeView.operationsDetailRoute,
		operationsCatalogSection,
		operationsDetailRouteKey: routeView.operationsDetailRouteKey,
		data: operationsData,
		renderOperations,
		renderOperationsDetailPage,
		renderSignature: response =>
			operationsRenderSignature(response, {
				chainId: requiredChainId(),
				url: new URL(location.href),
				networkName: state.networkRenderState.latestNetworks.find(network => String(network.chain_id) === requiredChainId())?.name,
				liveConnected: elements.connection.classList.contains('live'),
			}),
		renderRetryStatus,
	})

	/** Applies the detail tab named by the current URL to the rendered page, as after history traversal between tabs. */
	const showDetailTab = () => showOperationsDetailTab(lookup('#operations-content'), state.pageUrl.searchParams.get('tab'))

	return { components, routeView, loadOperations, showDetailTab }
}

export type OperationsViews = ReturnType<typeof createOperationsViews>
