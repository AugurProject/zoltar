import type { OperationsCatalogSection, OperationsDetailRoute, OperationsRenderContext } from './browser-types.ts'
import { decodeOperationsResponseValue, type OperationsResponse } from './api-validation.ts'
import { runSerializedOperationsLoad } from './live-refresh.ts'
import { operationsFailureMessage } from './operations-presentation.ts'
import type { OperationsRouteState } from './operations-state.ts'
import { routeDataContext } from './routes.ts'
import type { createOperationsData } from './operations-data.ts'

interface OperationsLoaderDeps {
	state: OperationsRouteState
	requiredChainId: () => string
	lookup: (selector: string) => HTMLElement
	api: (path: string) => Promise<unknown>
	operationsDetailRoute: () => OperationsDetailRoute | undefined
	operationsCatalogSection: () => OperationsCatalogSection | undefined
	operationsDetailRouteKey: (route: OperationsDetailRoute) => string
	data: ReturnType<typeof createOperationsData>
	renderOperations: (response: OperationsResponse, context?: OperationsRenderContext, live?: boolean) => void
	renderOperationsDetailPage: (response: OperationsResponse, route: OperationsDetailRoute, context?: OperationsRenderContext, live?: boolean) => void
	/** Identifies everything a response would render, so an unchanged live refresh can keep the rendered nodes. */
	renderSignature: (response: OperationsResponse) => string
	renderRetryStatus: (status: HTMLElement, message: string, retry: () => undefined | Promise<unknown>) => void
}

export const createOperationsLoader = (deps: OperationsLoaderDeps) => {
	const { state: operationsState, requiredChainId, api, operationsDetailRoute, operationsCatalogSection, operationsDetailRouteKey, renderOperations, renderOperationsDetailPage, renderRetryStatus } = deps
	const { loadOperationsCatalog, loadOperationsRiskCatalog, loadOperationsDetail } = deps.data
	const $ = deps.lookup
	const decodeOperationsResponse = decodeOperationsResponseValue
	let renderedSignature: string | undefined
	const loadOperations = async ({
		live = false,
		catalogTargetCount,
		riskPoolTargetCount,
		riskVaultTargetCount,
		detailTargetCount,
		decisionTargetCount,
		activityTargetCount,
		historyTargetOffset,
		preservedContext,
	}: {
		live?: boolean
		catalogTargetCount?: number
		riskPoolTargetCount?: number
		riskVaultTargetCount?: number
		detailTargetCount?: number
		decisionTargetCount?: number
		activityTargetCount?: number
		historyTargetOffset?: number
		preservedContext?: OperationsRenderContext
	} = {}): Promise<boolean> => {
		const requestedContext = routeDataContext(requiredChainId(), new URL(location.href))
		return await runSerializedOperationsLoad(
			operationsState.loadState,
			requestedContext,
			live,
			catalogTargetCount !== undefined || riskPoolTargetCount !== undefined || riskVaultTargetCount !== undefined || detailTargetCount !== undefined || decisionTargetCount !== undefined || activityTargetCount !== undefined || historyTargetOffset !== undefined,
			() => routeDataContext(requiredChainId(), new URL(location.href)),
			() => operationsState.requestVersion++,
			async () => {
				const requestVersion = ++operationsState.requestVersion
				const status = $('#operations-status')
				const content = $('#operations-content')
				const preserveRenderedContent = live && content.childElementCount > 0
				status.hidden = false
				status.className = preserveRenderedContent ? 'sr-only' : 'system-status'
				status.textContent = preserveRenderedContent ? 'Refreshing canonical protocol operations…' : 'Loading canonical protocol operations…'
				content.setAttribute('aria-busy', 'true')
				try {
					const detailRoute = operationsDetailRoute()
					const catalogSection = detailRoute === undefined ? operationsCatalogSection() : undefined
					const retainedCatalogCount = catalogSection !== undefined && catalogSection !== 'risk' && operationsState.catalogState?.chainId === requiredChainId() && operationsState.catalogState.section === catalogSection ? operationsState.catalogState.items.length : 0
					const retainedRiskPoolCount = catalogSection === 'risk' && operationsState.riskCatalogState?.chainId === requiredChainId() ? operationsState.riskCatalogState.pools.length : 0
					const retainedRiskVaultCount = catalogSection === 'risk' && operationsState.riskCatalogState?.chainId === requiredChainId() ? operationsState.riskCatalogState.vaults.length : 0
					const retainedDetailCount = detailRoute !== undefined && operationsState.detailState?.chainId === requiredChainId() && operationsState.detailState.routeKey === operationsDetailRouteKey(detailRoute) ? operationsState.detailState.items.length : 0
					const retainedRiskHistoryOffset =
						detailRoute !== undefined && (detailRoute.kind === 'pool' || detailRoute.kind === 'vault') && operationsState.detailState?.chainId === requiredChainId() && operationsState.detailState.routeKey === operationsDetailRouteKey(detailRoute) ? operationsState.detailState.riskHistoryOffset : 0
					const retainedDecisionCount = detailRoute?.kind === 'report' && operationsState.detailState?.chainId === requiredChainId() && operationsState.detailState.routeKey === operationsDetailRouteKey(detailRoute) ? operationsState.detailState.decisionItems.length : 0
					const retainedActivityCount = detailRoute?.kind === 'trading' && operationsState.detailState?.chainId === requiredChainId() && operationsState.detailState.routeKey === operationsDetailRouteKey(detailRoute) ? operationsState.detailState.activityItems.length : 0
					const loadResponse = async () => {
						if (detailRoute !== undefined) return await loadOperationsDetail(detailRoute, detailTargetCount ?? retainedDetailCount, historyTargetOffset ?? retainedRiskHistoryOffset, decisionTargetCount ?? retainedDecisionCount, activityTargetCount ?? retainedActivityCount)
						if (catalogSection === undefined) return decodeOperationsResponse(await api(`/api/v1/operations?chainId=${encodeURIComponent(requiredChainId())}`))
						if (catalogSection === 'risk') return await loadOperationsRiskCatalog(riskPoolTargetCount ?? retainedRiskPoolCount, riskVaultTargetCount ?? retainedRiskVaultCount)
						return await loadOperationsCatalog(catalogSection, catalogTargetCount ?? retainedCatalogCount)
					}
					const response = await loadResponse()
					if (requestVersion !== operationsState.requestVersion) return false
					const signature = deps.renderSignature(response)
					if (live && preservedContext === undefined && signature === renderedSignature && content.childElementCount > 0) {
						// Unchanged evidence keeps its nodes, so typed filters, open disclosures, and focus survive the refresh.
						content.setAttribute('aria-busy', 'false')
						status.hidden = true
						return true
					}
					if (detailRoute === undefined) renderOperations(response, preservedContext, live)
					else renderOperationsDetailPage(response, detailRoute, preservedContext, live)
					renderedSignature = signature
					return true
				} catch (error) {
					if (requestVersion !== operationsState.requestVersion) return false
					const detail = error instanceof Error ? error.message : 'Unknown operations request failure'
					status.dataset['errorDetail'] = detail
					if (preserveRenderedContent) {
						renderRetryStatus(status, operationsFailureMessage(true, error instanceof Error ? error.status : undefined, detail), () => loadOperations({ live: true }))
						content.setAttribute('aria-busy', 'false')
						return false
					}
					// The click event must not reach loadOperations, whose only parameter is its options object.
					renderRetryStatus(status, operationsFailureMessage(false, error instanceof Error ? error.status : undefined, detail), () => loadOperations())
					content.replaceChildren()
					renderedSignature = undefined
					content.setAttribute('aria-busy', 'false')
					return false
				}
			},
		)
	}

	return loadOperations
}
