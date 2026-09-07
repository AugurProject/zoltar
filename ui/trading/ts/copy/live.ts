export const marketDataUnavailable = 'Market data unavailable'
export const pairNotCreated = 'Pair not created'
export const tradingOpen = 'Trading open'
export const pairUninitialized = 'Pair uninitialized'
export const operational = 'Operational'
export const poolForked = 'Pool forked'
export const forkMigration = 'Fork migration'
export const forkTruthAuction = 'Fork truth auction'
export const invalid = 'INVALID'
export const yes = 'YES'
export const no = 'NO'
export const unresolvedOutcome = 'None (unresolved)'
export const conditionalPriceUnavailable = 'Conditional price unavailable until initialization.'
export const deployTradingPool = 'Deploy trading pool'
export const initializeTradingPool = 'Initialize trading pool'
export const refreshingSecurityPool = 'Refreshing security pool; showing the last successful result.'
export const retryingSecurityPoolDetails = 'Retrying security pool details…'
export const retryRefresh = 'Retry refresh'
export const retrySecurityPool = 'Retry security pool'
export const questionEnd = 'Question end'
export const systemState = 'System state'
export const universeFork = 'Universe fork'
export const notForked = 'Not forked'
export const outcome = 'Outcome'
export const securityMultiplier = 'Security multiplier'
export const initialReportPriorityFee = 'Initial report priority fee'
export const registeredVaults = 'Registered vaults'
export const perSecondRetentionMultiplier = 'Per-second retention multiplier'
export const totalAndFeeEligibleCapacityOwnership = 'Total / fee-eligible capacity ownership'
export const mintingCapacity = 'Minting capacity'
export const checkpointedCollateralShareRatio = 'Checkpointed collateral / share ratio'
export const noCompleteSetsYet = 'No complete sets yet'
export const unknownDiscovery = 'unknown discovery error'
export const loadingSecurityPoolDetails = 'Loading security pool details…'
export const retryDiscovery = 'Retry discovery'
export const securityPoolUnavailableInUniverse = 'This security pool is not available in the selected universe.'
export const retryDeployment = 'Retry deployment'
export const discoveringSecurityPoolsFromFactory = 'Discovering SecurityPools from the configured factory…'
export const noSecurityPoolsInUniverse = 'No SecurityPools are deployed in the selected universe.'
export const positions = 'Positions'
export const refresh = 'Refresh'
export const discoveringSecurityPools = 'Discovering SecurityPools…'
export const factoryDiscovery = 'Factory discovery'
export const securityPools = 'SecurityPools'
export const securityPoolPages = 'SecurityPool pages'
export const previousPools = 'Previous pools'
export const nextPools = 'Next pools'
export const backToSecurityPools = 'Back to SecurityPools'
export const securityPool = 'SecurityPool'
export const securityPoolLabel = 'Security pool'
export const pair = 'Pair'
export const ammFee = 'AMM fee'

export function unknownSystemState(state: number) {
	return `Unknown state ${state.toString()}`
}

export function unknownQuestionOutcome(outcome: number) {
	return `Unknown outcome ${outcome.toString()}`
}

export function pairInitializationUnavailable(blocker: string) {
	return `${blocker} — pair initialization unavailable`
}

export function undeployedPairDescription(feePercent: string) {
	return `This SecurityPool is available to browse, but it does not have a trading pool yet. Deployment is combined with the initial liquidity transaction. Trading fee: ${feePercent}%.`
}

export function uninitializedPairDescription(feePercent: string) {
	return `The trading pool exists but needs initial liquidity before trading can open. Trading fee: ${feePercent}%.`
}

export function securityPoolDetailsUnavailable(loadError: string, refreshError?: string) {
	return refreshError === undefined ? `Security pool details could not be loaded: ${loadError}` : `Security pool details could not be loaded: ${loadError}. Latest retry failed: ${refreshError}`
}

export function securityPoolRefreshFailed(refreshError: string) {
	return `SecurityPool refresh failed; showing the last successful result: ${refreshError}`
}

export function forkedAt(timestamp: string) {
	return `Forked ${timestamp}`
}

export function priorityFeePerGas(amount: string) {
	return `${amount} nETH / gas`
}

export function securityPoolDiscoveryFailed(error: string) {
	return `Security pool discovery failed: ${error}`
}

export function securityPoolFactoryDiscoveryFailed(error?: string) {
	return `SecurityPool discovery failed: ${error ?? ''}`
}

export function securityPoolCouldNotLoad(error: string) {
	return `This SecurityPool could not be loaded. No trading, liquidity, or settlement action is available until its authoritative reads succeed: ${error}`
}

export function poolPageRange(first: bigint, last: bigint, total: bigint) {
	return `${first.toString()}–${last.toString()} of ${total.toString()}`
}
