import type { StateTab } from './browser-types.ts'
import { createActivityDetailState, type ActivityDetailState } from './activity-detail-state.ts'
import { createActivityRouteState, type ActivityRouteState } from './activity-route-state.ts'
import { createCanonicalState, type CanonicalState } from './canonical-state.ts'
import { createForegroundRefreshGate, type RefreshGate } from './live-update.ts'
import { createNetworkRenderState, type NetworkRenderState } from './network-render.ts'
import { createOperationsRouteState, type OperationsRouteState } from './operations-state.ts'
import { classifyRoute, type ScannerRoute } from './routes.ts'
import { createScannerLiveState, type ScannerLiveState } from './scanner-live-state.ts'
import { createSystemRouteState, type SystemRouteState } from './system-route-state.ts'

interface ScannerRefreshGates {
	readonly log: RefreshGate
	readonly contract: RefreshGate
	readonly richList: RefreshGate
	readonly addressProfile: RefreshGate
	readonly systemState: RefreshGate
	readonly systemDetail: RefreshGate
	readonly detail: RefreshGate
	readonly accountPage: RefreshGate
}

/** Mutable page-level state shared by the scanner's route, live-update, and navigation modules. */
export interface ScannerState {
	pageUrl: URL
	route: ScannerRoute
	viewContextVersion: number
	navigationGeneration: number
	readonly isDemo: boolean
	readonly connectionDemo: string | null
	readonly usesDemoConnectionLabel: boolean
	readonly initialChainId: string
	readonly initialActivityFilters: { readonly event: string; readonly address: string }
	readonly loadedRouteContexts: Set<string>
	readonly activityRoute: ActivityRouteState
	readonly operationsState: OperationsRouteState
	readonly activityDetailState: ActivityDetailState
	readonly canonicalState: CanonicalState
	readonly systemRouteState: SystemRouteState
	readonly liveState: ScannerLiveState
	readonly networkRenderState: NetworkRenderState
	readonly refreshGates: ScannerRefreshGates
}

export const createScannerState = (pageUrl: URL, isDemo: boolean): ScannerState => {
	const connectionDemo = isDemo ? pageUrl.searchParams.get('connectionDemo') : null
	const initialActivityFilters = {
		event: pageUrl.searchParams.get('event') ?? '',
		address: pageUrl.searchParams.get('address') ?? '',
	}
	return {
		pageUrl,
		route: classifyRoute(location.pathname),
		viewContextVersion: 0,
		navigationGeneration: 0,
		isDemo,
		connectionDemo,
		usesDemoConnectionLabel: isDemo && connectionDemo !== 'indexer' && connectionDemo !== 'reconnecting',
		initialChainId: pageUrl.searchParams.get('chainId') ?? '',
		initialActivityFilters,
		loadedRouteContexts: new Set<string>(),
		activityRoute: createActivityRouteState(initialActivityFilters),
		operationsState: createOperationsRouteState(),
		activityDetailState: createActivityDetailState(),
		canonicalState: createCanonicalState(),
		systemRouteState: createSystemRouteState(),
		liveState: createScannerLiveState(),
		networkRenderState: createNetworkRenderState(),
		refreshGates: {
			log: createForegroundRefreshGate(),
			contract: createForegroundRefreshGate(),
			richList: createForegroundRefreshGate(),
			addressProfile: createForegroundRefreshGate(),
			systemState: createForegroundRefreshGate(),
			systemDetail: createForegroundRefreshGate(),
			detail: createForegroundRefreshGate(),
			accountPage: createForegroundRefreshGate(),
		},
	}
}

export const selectedChainId = (state: Pick<ScannerState, 'initialChainId'>, globalNetworkFilter: HTMLSelectElement): string => (globalNetworkFilter.dataset['restored'] === 'true' ? globalNetworkFilter.value : state.initialChainId)

export const requireChainId = (chainId: string): string => {
	if (chainId === '') throw new Error('Waiting for network status before loading this view')
	return chainId
}

export const nativeSymbolFor = (chainId: string): string => (String(chainId) === '1' ? 'ETH' : 'SepoliaETH')

export const isStateTab = (value: string | undefined | null): value is StateTab => value === 'pools' || value === 'vaults' || value === 'questions' || value === 'universes'

/** Advances every request-version counter so in-flight responses for the previous route are discarded. */
export const invalidateStateRequestVersions = (state: ScannerState): void => {
	state.viewContextVersion++
	state.activityDetailState.detailContextVersion++
	state.systemRouteState.detailContextVersion++
}

export const abortActivityRequests = (state: ScannerState): void => {
	state.activityRoute.abortController?.abort()
	state.activityRoute.abortController = undefined
	state.activityRoute.requestVersion++
}

export const clearLiveTimers = (state: ScannerState): void => {
	if (state.liveState.blockRefreshTimer !== undefined) clearTimeout(state.liveState.blockRefreshTimer)
	state.liveState.blockRefreshTimer = undefined
	if (state.networkRenderState.headFreshnessTimer !== undefined) clearTimeout(state.networkRenderState.headFreshnessTimer)
	state.networkRenderState.headFreshnessTimer = undefined
	state.liveState.pendingBlockUpdates = 0
}
