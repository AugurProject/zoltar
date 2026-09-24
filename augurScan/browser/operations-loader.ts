import type { OperationsCatalogSection, OperationsDetailRoute, OperationsRenderContext } from './browser-types.ts'
import { decodeOperationsResponseValue, type OperationsResponse } from './api-validation.ts'
import { runSerializedOperationsLoad } from './live-update.ts'
import type { OperationsRouteState } from './operations-state.ts'
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
	renderOperations: (response: OperationsResponse, context?: OperationsRenderContext) => void
	renderOperationsDetailPage: (response: OperationsResponse, route: OperationsDetailRoute, context?: OperationsRenderContext) => void
	renderRetryStatus: (status: HTMLElement, message: string, retry: () => undefined | Promise<unknown>) => void
}

export const createOperationsLoader = (deps: OperationsLoaderDeps) => {
	const { state: operationsState, requiredChainId, api, operationsDetailRoute, operationsCatalogSection, operationsDetailRouteKey, renderOperations, renderOperationsDetailPage, renderRetryStatus } = deps
	const { loadOperationsCatalog, loadOperationsRiskCatalog, loadOperationsDetail } = deps.data
	const $ = deps.lookup
	const decodeOperationsResponse = decodeOperationsResponseValue
	const loadOperations = async ({
		live = false,
		catalogTargetCount,
		riskPoolTargetCount,
		riskVaultTargetCount,
		detailTargetCount,
		decisionTargetCount,
		historyTargetOffset,
		preservedContext,
	}: {
		live?: boolean
		catalogTargetCount?: number
		riskPoolTargetCount?: number
		riskVaultTargetCount?: number
		detailTargetCount?: number
		decisionTargetCount?: number
		historyTargetOffset?: number
		preservedContext?: OperationsRenderContext
	} = {}): Promise<boolean> => {
		const requestedContext = `${requiredChainId()}:${location.pathname}`
		return await runSerializedOperationsLoad(
			operationsState.loadState,
			requestedContext,
			live,
			catalogTargetCount !== undefined || riskPoolTargetCount !== undefined || riskVaultTargetCount !== undefined || detailTargetCount !== undefined || decisionTargetCount !== undefined || historyTargetOffset !== undefined,
			() => `${requiredChainId()}:${location.pathname}`,
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
					const loadResponse = async () => {
						if (detailRoute !== undefined) return await loadOperationsDetail(detailRoute, detailTargetCount ?? retainedDetailCount, historyTargetOffset ?? retainedRiskHistoryOffset, decisionTargetCount ?? retainedDecisionCount)
						if (catalogSection === undefined) return decodeOperationsResponse(await api(`/api/v1/operations?chainId=${encodeURIComponent(requiredChainId())}`))
						if (catalogSection === 'risk') return await loadOperationsRiskCatalog(riskPoolTargetCount ?? retainedRiskPoolCount, riskVaultTargetCount ?? retainedRiskVaultCount)
						return await loadOperationsCatalog(catalogSection, catalogTargetCount ?? retainedCatalogCount)
					}
					const response = await loadResponse()
					if (requestVersion !== operationsState.requestVersion) return false
					if (detailRoute === undefined) renderOperations(response, preservedContext)
					else renderOperationsDetailPage(response, detailRoute, preservedContext)
					return true
				} catch (error) {
					if (requestVersion !== operationsState.requestVersion) return false
					if (preserveRenderedContent) {
						status.className = 'system-status'
						status.dataset.errorDetail = error instanceof Error ? error.message : 'Unknown operations refresh failure'
						renderRetryStatus(status, 'Could not refresh protocol operations. Existing evidence remains visible.', () => loadOperations({ live: true }))
						content.setAttribute('aria-busy', 'false')
						return false
					}
					status.dataset.errorDetail = error instanceof Error ? error.message : 'Unknown operations request failure'
					renderRetryStatus(status, 'Could not load protocol operations.', loadOperations)
					content.replaceChildren()
					content.setAttribute('aria-busy', 'false')
					return false
				}
			},
		)
	}

	return loadOperations
}
