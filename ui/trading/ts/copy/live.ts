import * as appCopy from './app.js'

const marketDataUnavailable = 'Market data unavailable'
const pairNotCreated = 'Pair not created'
const tradingOpen = 'Trading open'
const pairUninitialized = 'Pair uninitialized'
const operational = 'Operational'
const poolForked = 'Pool forked'
const forkMigration = 'Fork migration'
const forkTruthAuction = 'Fork truth auction'
const invalid = 'INVALID'
const yes = 'YES'
const no = 'NO'
const unresolvedOutcome = 'None (unresolved)'
const conditionalPriceUnavailable = 'Conditional price unavailable until initialization.'
const deployTradingPool = 'Deploy trading pool'
const initializeTradingPool = 'Initialize trading pool'
const refreshingSecurityPool = 'Refreshing security pool; showing the last successful result.'
const retryingSecurityPoolDetails = 'Retrying security pool details…'
const retryRefresh = 'Retry refresh'
const retrySecurityPool = 'Retry security pool'
const questionEnd = 'Question end'
const systemState = 'System state'
const universeFork = 'Universe fork'
const notForked = 'Not forked'
const outcome = 'Outcome'
const securityMultiplier = 'Security multiplier'
const initialReportPriorityFee = 'Initial report priority fee'
const registeredVaults = 'Registered vaults'
const perSecondRetentionMultiplier = 'Per-second retention multiplier'
const totalAndFeeEligibleCapacityOwnership = 'Total / fee-eligible capacity ownership'
const mintingCapacity = 'Minting capacity'
const unknownDiscovery = 'unknown discovery error'
const loadingSecurityPoolDetails = 'Loading security pool details…'
const retryDiscovery = 'Retry discovery'
const securityPoolUnavailableInUniverse = 'This security pool is not available in the selected universe.'
const discoveringSecurityPoolsFromFactory = 'Discovering security pools from the configured factory…'
const noSecurityPoolsInUniverse = 'No security pools are deployed in the selected universe.'
const discoveringSecurityPools = 'Discovering security pools…'
const securityPoolPages = 'Security pool pages'
const previousPools = 'Previous pools'
const nextPools = 'Next pools'
const securityPool = appCopy.securityPool
const securityPoolLabel = 'Security pool'
const pair = 'Pair'
const ammFee = 'AMM fee'

function unknownSystemState(state: number) {
	return `Unknown state ${state.toString()}`
}

function unknownQuestionOutcome(outcome: number) {
	return `Unknown outcome ${outcome.toString()}`
}

function pairInitializationUnavailable(blocker: string) {
	return `${blocker} — pair initialization unavailable`
}

function undeployedPairDescription(feePercent: string) {
	return `This security pool is available to browse, but it does not have a trading pool yet. Deployment is combined with the initial liquidity transaction. Trading fee: ${feePercent}%.`
}

function uninitializedPairDescription(feePercent: string) {
	return `The trading pool exists but needs initial liquidity before trading can open. Trading fee: ${feePercent}%.`
}

function securityPoolDetailsUnavailable(loadError: string, refreshError?: string) {
	return refreshError === undefined ? `Security pool details could not be loaded: ${loadError}` : `Security pool details could not be loaded: ${loadError}. Latest retry failed: ${refreshError}`
}

function securityPoolRefreshFailed(refreshError: string) {
	return `Security pool refresh failed; showing the last successful result: ${refreshError}`
}

const forkedAt = 'Forked'

function priorityFeePerGas(amount: string) {
	return `${amount} nETH / gas`
}

function securityPoolDiscoveryFailed(error: string) {
	return `Security pool discovery failed: ${error}`
}

function securityPoolFactoryDiscoveryFailed(error?: string) {
	return `Security pool discovery failed: ${error ?? ''}`
}

function securityPoolCouldNotLoad(error: string) {
	return `This security pool could not be loaded. No trading, liquidity, or settlement action is available until its authoritative reads succeed: ${error}`
}

function poolPageRange(first: bigint, last: bigint, total: bigint) {
	return `${first.toString()}–${last.toString()} of ${total.toString()}`
}

export const liveCopy = {
	openByAddress: 'Open by address',
	poolAlreadyExists: 'This pool already has a trading market.',
	openPoolAddress: 'Security pool address',
	poolAddressPlaceholder: '0x…',
	invalidPoolAddress: 'Enter a valid, nonzero security pool address.',
	openPool: 'Open pool',
	tradePool: 'Trade this pool',
	marketDataUnavailable,
	pairNotCreated,
	tradingOpen,
	pairUninitialized,
	operational,
	poolForked,
	forkMigration,
	forkTruthAuction,
	invalid,
	yes,
	no,
	unresolvedOutcome,
	conditionalPriceUnavailable,
	deployTradingPool,
	initializeTradingPool,
	refreshingSecurityPool,
	retryingSecurityPoolDetails,
	retryRefresh,
	retrySecurityPool,
	questionEnd,
	systemState,
	universeFork,
	notForked,
	outcome,
	securityMultiplier,
	initialReportPriorityFee,
	registeredVaults,
	perSecondRetentionMultiplier,
	totalAndFeeEligibleCapacityOwnership,
	mintingCapacity,
	unknownDiscovery,
	loadingSecurityPoolDetails,
	retryDiscovery,
	securityPoolUnavailableInUniverse,
	discoveringSecurityPoolsFromFactory,
	noSecurityPoolsInUniverse,
	discoveringSecurityPools,
	marketCreated: (title: string) => `Market created: ${title}`,
	noEligiblePools: 'No security pools on this page are available for a new market.',
	noMarketsOnPage: 'No trading markets on this page.',
	marketList: 'Markets',
	securityPoolList: appCopy.securityPools,
	securityPoolListDescription: 'Security pools in the selected universe without a trading market.',
	trade: 'Trade',
	manageLiquidity: 'Liquidity',
	createMarketAction: 'Create market',
	poolDetails: 'Details',
	noPoolSelected: 'No security pool selected',
	noPoolSelectedDetail: 'Open a security pool address to load its market.',
	marketFacts: 'Pool facts',
	lifecycle: 'Lifecycle',
	capacity: 'Capacity',
	notDeployed: 'Not deployed',
	securityPoolPages,
	previousPools,
	nextPools,
	securityPool,
	securityPoolLabel,
	pair,
	ammFee,
	unknownSystemState,
	unknownQuestionOutcome,
	pairInitializationUnavailable,
	undeployedPairDescription,
	uninitializedPairDescription,
	securityPoolDetailsUnavailable,
	securityPoolRefreshFailed,
	forkedAt,
	priorityFeePerGas,
	securityPoolDiscoveryFailed,
	securityPoolFactoryDiscoveryFailed,
	securityPoolCouldNotLoad,
	poolPageRange,
} as const
