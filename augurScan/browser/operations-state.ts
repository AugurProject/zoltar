import type { OperationsRoutePosition, PagedOperationsCatalogSection } from './browser-types.ts'
import type { JsonRecord } from './api-validation.ts'

interface CatalogState {
	readonly chainId: string
	readonly section: PagedOperationsCatalogSection
	readonly items: readonly JsonRecord[]
}

interface RiskCatalogState {
	readonly chainId: string
	readonly pools: readonly JsonRecord[]
	readonly vaults: readonly JsonRecord[]
}

interface DetailState {
	readonly chainId: string
	readonly routeKey: string
	readonly items: readonly JsonRecord[]
	readonly decisionItems: readonly JsonRecord[]
	readonly riskHistoryOffset: number
}

interface CachedRoute {
	readonly fragment: DocumentFragment
	readonly catalogState: CatalogState | undefined
	readonly riskCatalogState: RiskCatalogState | undefined
	readonly detailState: DetailState | undefined
	readonly scrollY: number
	readonly focusedIndex?: number
}

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]'

export interface OperationsRouteState {
	requestVersion: number
	loadState: { promise?: Promise<boolean>; context?: string }
	catalogState: CatalogState | undefined
	riskCatalogState: RiskCatalogState | undefined
	detailState: DetailState | undefined
	demoRiskHistoryAutoLoadConsumed: boolean
	routeCache: Map<string, CachedRoute>
	renderedContext: string | undefined
	stash(content: HTMLElement): void
	restore(context: string, content: HTMLElement): OperationsRoutePosition | undefined
}

export const createOperationsRouteState = (): OperationsRouteState => {
	const state: OperationsRouteState = {
		requestVersion: 0,
		loadState: {},
		catalogState: undefined,
		riskCatalogState: undefined,
		detailState: undefined,
		demoRiskHistoryAutoLoadConsumed: false,
		routeCache: new Map(),
		renderedContext: undefined,
		stash(content) {
			if (state.renderedContext === undefined) return
			const focusedElements = [...content.querySelectorAll<HTMLElement>(focusableSelector)]
			const focusedIndex = document.activeElement instanceof HTMLElement ? focusedElements.indexOf(document.activeElement) : -1
			const fragment = document.createDocumentFragment()
			fragment.append(...content.childNodes)
			state.routeCache.set(state.renderedContext, {
				fragment,
				catalogState: state.catalogState,
				riskCatalogState: state.riskCatalogState,
				detailState: state.detailState,
				scrollY: window.scrollY,
				...(focusedIndex < 0 ? {} : { focusedIndex }),
			})
		},
		restore(context, content) {
			const snapshot = state.routeCache.get(context)
			if (snapshot === undefined) {
				state.renderedContext = undefined
				return undefined
			}
			content.replaceChildren(snapshot.fragment)
			state.catalogState = snapshot.catalogState
			state.riskCatalogState = snapshot.riskCatalogState
			state.detailState = snapshot.detailState
			state.routeCache.delete(context)
			state.renderedContext = context
			window.scrollTo({ top: snapshot.scrollY })
			if (snapshot.focusedIndex !== undefined) content.querySelectorAll<HTMLElement>(focusableSelector)[snapshot.focusedIndex]?.focus({ preventScroll: true })
			return { scrollY: snapshot.scrollY, ...(snapshot.focusedIndex === undefined ? {} : { focusedIndex: snapshot.focusedIndex }) }
		},
	}
	return state
}
