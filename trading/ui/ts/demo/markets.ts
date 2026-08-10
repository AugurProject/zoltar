export type Lifecycle = 'open' | 'ended' | 'forked' | 'resolved-invalid' | 'resolved-yes' | 'resolved-no' | 'truth-auction'

export type DemoMarket = Readonly<{
	id: string
	question: string
	universe: string
	pool: `0x${string}`
	shareToken: `0x${string}`
	universeId: bigint
	pair?: `0x${string}`
	endTime: string
	lifecycle: Lifecycle
	yesReserve: bigint
	noReserve: bigint
	lpTotalSupply: bigint
	feeBps: bigint
	securityPool: Readonly<{
		systemState: 'Operational' | 'Pool forked' | 'Fork migration' | 'Fork truth auction'
		questionOutcome: 'Unresolved' | 'INVALID' | 'YES' | 'NO'
		awaitingForkContinuation: boolean
		statoblastSecurityMultiplierBps: bigint
		initialReportPriorityFeeAttoEthPerGas: bigint
		totalCapacityOwnershipAttoRep: bigint
		feeEligibleCapacityOwnershipAttoRep: bigint
		mintingCapacityCeilingAttoEth: bigint
		availableMintingCapacityAttoEth: bigint
		settlementCollateralAttoEth: bigint
		shareTokenSupplyAttoShares: bigint
		vaultCount: bigint
	}>
}>

export const demoWalletBalances = {
	yes: 2_050_000_000_000_000_000_000n,
	no: 184_090_000_000_000_000_000n,
	invalid: 750_000_000_000_000_000_000n,
	lp: 428_570_000_000_000_000_000n,
} as const

const pool = `0x${'3a'.repeat(20)}` as const
const pair = `0x${'7c'.repeat(20)}` as const
const childPool = `0x${'4b'.repeat(20)}` as const
const childPair = `0x${'8d'.repeat(20)}` as const
const shareToken = `0x${'5e'.repeat(20)}` as const

export function demoAttoEthToAttoShares(amountAttoEth: bigint, market: DemoMarket) {
	if (market.securityPool.shareTokenSupplyAttoShares === 0n) return amountAttoEth * 10n ** 18n
	if (market.securityPool.settlementCollateralAttoEth === 0n) throw new Error('SecurityPool exchange rate is undefined')
	return (amountAttoEth * market.securityPool.shareTokenSupplyAttoShares) / market.securityPool.settlementCollateralAttoEth
}

export function demoAttoSharesToAttoEth(amountAttoShares: bigint, market: DemoMarket) {
	if (amountAttoShares < 0n) throw new Error('Share amount cannot be negative')
	if (market.securityPool.shareTokenSupplyAttoShares === 0n) return 0n
	return (amountAttoShares * market.securityPool.settlementCollateralAttoEth) / market.securityPool.shareTokenSupplyAttoShares
}

export function demoMarket(scenario: string): DemoMarket {
	let lifecycle: Lifecycle = 'open'
	let systemState: DemoMarket['securityPool']['systemState'] = 'Operational'
	let universe = 'Genesis universe'
	if (scenario === 'ended' || scenario === 'ended-missing-pair') lifecycle = 'ended'
	if (scenario === 'forked') {
		lifecycle = 'forked'
		systemState = 'Pool forked'
		universe = 'Parent universe · forked'
	}
	if (scenario === 'resolved-invalid') lifecycle = 'resolved-invalid'
	if (scenario === 'truth-auction') {
		lifecycle = 'truth-auction'
		systemState = 'Fork truth auction'
		universe = 'Child universe · YES branch'
	}
	const selectedPool = scenario === 'truth-auction' ? childPool : pool
	const selectedPair = scenario === 'truth-auction' ? childPair : pair
	let universeId = 1n
	if (scenario === 'truth-auction') universeId = 2n
	if (scenario === 'max-token-ids') universeId = (1n << 248n) - 1n
	if (scenario === 'max-token-ids-alt') universeId = (1n << 248n) - 2n
	const common = {
		id: 'eth-10k-2027',
		question: 'Will ETH trade above $10,000 before 1 January 2027?',
		universe,
		pool: selectedPool,
		shareToken,
		universeId,
		endTime: '31 Dec 2026 · 23:59 UTC',
		lifecycle,
		yesReserve: 428_571_000_000_000_000_000n,
		noReserve: 1_000_000_000_000_000_000_000n,
		lpTotalSupply: 428_571_000_000_000_000_000n,
		feeBps: 30n,
		securityPool: {
			systemState,
			questionOutcome: scenario === 'resolved-invalid' ? ('INVALID' as const) : ('Unresolved' as const),
			awaitingForkContinuation: false,
			statoblastSecurityMultiplierBps: 20_000n,
			initialReportPriorityFeeAttoEthPerGas: 2n * 10n ** 9n,
			totalCapacityOwnershipAttoRep: 10_000n * 10n ** 18n,
			feeEligibleCapacityOwnershipAttoRep: 9_500n * 10n ** 18n,
			mintingCapacityCeilingAttoEth: 10_000_000_000_000_000_000_000n,
			availableMintingCapacityAttoEth: 7_531_500_000_000_000_000_000n,
			settlementCollateralAttoEth: 2_468_500_000_000_000_000_000n,
			shareTokenSupplyAttoShares: 2_500_000_000_000_000_000_000n,
			vaultCount: 3n,
		},
	}
	if (scenario === 'missing-pair' || scenario === 'ended-missing-pair') return { ...common, yesReserve: 0n, noReserve: 0n, lpTotalSupply: 0n }
	if (scenario === 'uninitialized-pair') return { ...common, pair: selectedPair, yesReserve: 0n, noReserve: 0n, lpTotalSupply: 0n }
	return { ...common, pair: selectedPair }
}

export function lifecycleLabel(lifecycle: Lifecycle) {
	switch (lifecycle) {
		case 'open':
			return 'Trading open'
		case 'ended':
			return 'Question ended'
		case 'forked':
			return 'Parent universe forked'
		case 'resolved-invalid':
			return 'Resolved INVALID'
		case 'resolved-yes':
			return 'Resolved YES'
		case 'resolved-no':
			return 'Resolved NO'
		case 'truth-auction':
			return 'Truth auction in progress'
		default:
			throw new Error(`Unknown lifecycle: ${lifecycle}`)
	}
}

export function tradingClosedReason(lifecycle: Lifecycle) {
	return lifecycle === 'open' ? undefined : lifecycleLabel(lifecycle)
}
