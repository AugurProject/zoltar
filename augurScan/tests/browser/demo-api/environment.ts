import type { DemoContext } from '../../../browser/demo-runtime.ts'
import { createDemoCatalogFixtures } from './catalog-fixtures.ts'
import { createDemoChainFixtures } from './chain-fixtures.ts'
import { createDemoClaimFixtures } from './claim-fixtures.ts'

// Scenario parameters captured once when the demo API is created; later navigation does not change them.
type DemoSettings = {
	readonly demoState: string | null
	readonly priceDemo: string | null
	readonly detailState: string | null
	readonly claimState: string | null
	readonly deploymentState: string | null
	readonly networkState: string | null
}

// Mutable per-session request counters and one-shot failure flags used by the scenario fixtures.
type DemoCounters = {
	errorConsumed: boolean
	detailErrorConsumed: boolean
	stateDetailRequests: number
	transactionRequests: number
	logRequests: number
	richListRequests: number
	networkRequests: number
	routeRequestsInFlight: number
	maxRouteRequestsInFlight: number
	reorgObserved: boolean
	evictedAddress: string | undefined
	reorgRefreshErrorConsumed: boolean
	transactionSnapshotInvalidated: boolean
	canonicalRouteRefreshErrorConsumed: boolean
	transactionRestoreErrorConsumed: boolean
	transactionAppendErrorConsumed: boolean
	networkFallbackErrorConsumed: boolean
	catalogShifted: boolean
	dualCatalogShifted: boolean
	poolLiveShifted: boolean
	catalogRequests: number
	routeRefreshErrorConsumed: boolean
	riskHistoryAppendErrorConsumed: boolean
	stateHistoryAppendErrorConsumed: boolean
	portfolioAppendErrorConsumed: boolean
	liveSequence: number
}

export type DemoApi = (path: string, options?: { signal?: AbortSignal }) => Promise<unknown>

const readDemoSettings = (context: DemoContext): DemoSettings => ({
	demoState: context.pageUrl.searchParams.get('state'),
	priceDemo: context.pageUrl.searchParams.get('priceDemo'),
	detailState: context.pageUrl.searchParams.get('detailState'),
	claimState: context.pageUrl.searchParams.get('claimState'),
	deploymentState: context.pageUrl.searchParams.get('deploymentState'),
	networkState: context.pageUrl.searchParams.get('networkState'),
})

const createDemoCounters = (): DemoCounters => ({
	errorConsumed: false,
	detailErrorConsumed: false,
	stateDetailRequests: 0,
	transactionRequests: 0,
	logRequests: 0,
	richListRequests: 0,
	networkRequests: 0,
	routeRequestsInFlight: 0,
	maxRouteRequestsInFlight: 0,
	reorgObserved: false,
	evictedAddress: undefined,
	reorgRefreshErrorConsumed: false,
	transactionSnapshotInvalidated: false,
	canonicalRouteRefreshErrorConsumed: false,
	transactionRestoreErrorConsumed: false,
	transactionAppendErrorConsumed: false,
	networkFallbackErrorConsumed: false,
	catalogShifted: false,
	dualCatalogShifted: false,
	poolLiveShifted: false,
	catalogRequests: 0,
	routeRefreshErrorConsumed: false,
	riskHistoryAppendErrorConsumed: false,
	stateHistoryAppendErrorConsumed: false,
	portfolioAppendErrorConsumed: false,
	liveSequence: 0,
})

export const createDemoEnvironment = (context: DemoContext) => {
	const settings = readDemoSettings(context)
	const fixtures = {
		...createDemoClaimFixtures(settings.claimState),
		...createDemoChainFixtures(),
		...createDemoCatalogFixtures(context),
	}
	return { context, settings, fixtures, counters: createDemoCounters() }
}

export type DemoEnvironment = ReturnType<typeof createDemoEnvironment>
