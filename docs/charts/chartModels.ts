export type AuctionBidInput = {
	eth: number
	key: 'alice' | 'bob' | 'carol'
	name: string
	price: number
}

type AuctionBidResult = AuctionBidInput & {
	chartRep: number
	rep: number
	status: 'Accepted' | 'Partially filled' | 'Rejected'
}

export type AuctionModel = {
	bids: AuctionBidResult[]
	clearingPrice: number
	demandPoints: { cumulativeRep: number; price: number }[]
	effectivePrice: number
	ethRaised: number
	mode: 'underfunded' | 'uniform'
	qualificationPrice: number
}

export function calculateAuctionModel(ethRaiseCap: number, repInventory: number, bids: AuctionBidInput[]): AuctionModel {
	const qualificationPrice = ethRaiseCap / repInventory
	const submittedBids = bids.filter(bid => bid.eth > 0)
	const activeBids = submittedBids.filter(bid => bid.price >= qualificationPrice).sort((left, right) => right.price - left.price)
	const ticks = Array.from(new Set(activeBids.map(bid => bid.price))).map(price => ({
		bids: activeBids.filter(bid => bid.price === price),
		price,
		totalEth: activeBids.filter(bid => bid.price === price).reduce((sum, bid) => sum + bid.eth, 0),
	}))
	let accumulatedEth = 0
	let clearingPrice = 0
	let ethFilledAtClearing = 0
	let funded = false
	let lastValidPrice = 0
	let lastValidEthAtTick = 0
	const demandPoints: AuctionModel['demandPoints'] = []
	const chartRepByKey = new Map<AuctionBidInput['key'], number>()
	for (const tick of ticks) {
		if (accumulatedEth > 0 && accumulatedEth / tick.price > repInventory) {
			funded = true
			clearingPrice = lastValidPrice
			ethFilledAtClearing = lastValidEthAtTick
			break
		}
		const ethToTake = Math.min(tick.totalEth, Math.max(0, ethRaiseCap - accumulatedEth))
		const newAccumulatedEth = accumulatedEth + ethToTake
		const candidateRep = newAccumulatedEth / tick.price
		demandPoints.push({ cumulativeRep: candidateRep, price: tick.price })
		for (const bid of tick.bids) {
			chartRepByKey.set(bid.key, candidateRep)
		}
		if (candidateRep >= repInventory) {
			funded = true
			clearingPrice = tick.price
			ethFilledAtClearing = Math.max(0, Math.min(ethToTake, repInventory * tick.price - accumulatedEth))
			accumulatedEth += ethFilledAtClearing
			break
		}
		if (newAccumulatedEth >= ethRaiseCap) {
			funded = true
			clearingPrice = tick.price
			ethFilledAtClearing = ethToTake
			accumulatedEth = newAccumulatedEth
			break
		}
		accumulatedEth = newAccumulatedEth
		lastValidPrice = tick.price
		lastValidEthAtTick = ethToTake
	}

	const repByKey = new Map<AuctionBidInput['key'], number>()
	let effectivePrice = clearingPrice
	if (funded && clearingPrice > 0) {
		let clearingTickEthRemaining = ethFilledAtClearing
		for (const bid of activeBids) {
			if (bid.price > clearingPrice) {
				repByKey.set(bid.key, bid.eth / clearingPrice)
			} else if (bid.price === clearingPrice) {
				const fillEth = Math.min(bid.eth, clearingTickEthRemaining)
				clearingTickEthRemaining -= fillEth
				repByKey.set(bid.key, fillEth / clearingPrice)
			}
		}
	} else {
		const winningEth = activeBids.reduce((sum, bid) => sum + bid.eth, 0)
		accumulatedEth = winningEth
		if (winningEth > 0) {
			for (const bid of activeBids) {
				repByKey.set(bid.key, (bid.eth * repInventory) / winningEth)
			}
		}
		clearingPrice = qualificationPrice
		effectivePrice = winningEth > 0 ? winningEth / repInventory : 0
	}

	const results = bids.map(bid => {
		const rep = repByKey.get(bid.key) ?? 0
		let status: AuctionBidResult['status'] = 'Rejected'
		if (rep > 0) {
			const fullRepAtClearing = bid.eth / effectivePrice
			status = funded && rep + 1e-9 < fullRepAtClearing ? 'Partially filled' : 'Accepted'
		}
		return { ...bid, chartRep: chartRepByKey.get(bid.key) ?? bid.eth / Math.max(bid.price, Number.EPSILON), rep, status }
	})
	return {
		bids: results,
		clearingPrice,
		demandPoints,
		effectivePrice,
		ethRaised: accumulatedEth,
		mode: funded ? 'uniform' : 'underfunded',
		qualificationPrice,
	}
}

export function calculateCollateralRepairModel(
	parentCollateral: number,
	forkCollateralReceived: number,
	auctionRaised: number,
): {
	initialShortfall: number
	received: number
	remainingShortfall: number
	repairEth: number
} {
	const received = Math.min(Math.max(forkCollateralReceived, 0), Math.max(parentCollateral, 0))
	const initialShortfall = Math.max(0, parentCollateral - received)
	const repairEth = Math.min(Math.max(auctionRaised, 0), initialShortfall)
	return {
		initialShortfall,
		received,
		remainingShortfall: initialShortfall - repairEth,
		repairEth,
	}
}

export type OracleSecurityModel = {
	attackerProfit: number
	censorshipCost: number
	censorshipRate: number
	executionErrorThreshold: number
	griefTarget: number
	liquidationExecutable: boolean
	manipulatedPriceError: number
	safeCensorshipDuration: number
}

export function calculateOracleSecurityModel(input: {
	censorshipDuration: number
	externalPayoff: number
	honestDisputeBarrierFraction: number
	honestPrice: number
	liquidationThresholdPrice: number
	manipulatedPrice: number
	minLiquidationPriceDistanceBps: number
	oracleReportLiquidity: number
	targetGriefRatio: number
}): OracleSecurityModel {
	const liquidationDistanceFraction = Math.min(Math.max(input.minLiquidationPriceDistanceBps, 0), 10_000) / 10_000
	const discountedHonestPrice = input.honestPrice * (1 - liquidationDistanceFraction)
	const executionErrorThreshold = discountedHonestPrice === 0 ? Number.POSITIVE_INFINITY : Math.max(0, input.liquidationThresholdPrice / discountedHonestPrice - 1)
	const manipulatedPriceError = Math.max(0, (input.manipulatedPrice - input.honestPrice) / input.honestPrice)
	const liquidationExecutable = input.manipulatedPrice > input.liquidationThresholdPrice && manipulatedPriceError >= executionErrorThreshold
	const attackerProfit = liquidationExecutable ? input.externalPayoff : 0
	const censorshipRate = Math.max(0, manipulatedPriceError - input.honestDisputeBarrierFraction)
	const censorshipCost = input.censorshipDuration * censorshipRate * input.oracleReportLiquidity
	const oracleLiquidityRatio = input.oracleReportLiquidity / input.externalPayoff
	const safeCensorshipDuration = censorshipRate === 0 ? Number.POSITIVE_INFINITY : (input.targetGriefRatio + 1) / (censorshipRate * oracleLiquidityRatio)
	return {
		attackerProfit,
		censorshipCost,
		censorshipRate,
		executionErrorThreshold,
		griefTarget: liquidationExecutable ? (input.targetGriefRatio + 1) * input.externalPayoff : 0,
		liquidationExecutable,
		manipulatedPriceError,
		safeCensorshipDuration,
	}
}

const atomicScale = 1_000_000_000_000_000_000n

export function calculateEscalationDepositModel(input: { invalidBalance: number; noBalance: number; nonDecisionThreshold: number; proposedDeposit: number; repeatDeposit: boolean; startBond: number; yesBalance: number }): {
	accepted: number
	acceptedAtomic: bigint
	effectiveStartBondAtomic: bigint
	noAfter: number
	noAfterAtomic: bigint
	previewReverts: boolean
	threshold: number
	tieAdjusted: boolean
} {
	const threshold = Math.max(input.nonDecisionThreshold, 1)
	const thresholdAtomic = BigInt(Math.round(threshold * Number(atomicScale)))
	const enteredStartBondAtomic = BigInt(Math.round(input.startBond * Number(atomicScale)))
	const effectiveStartBondAtomic = !input.repeatDeposit && enteredStartBondAtomic >= thresholdAtomic ? thresholdAtomic - 1n : enteredStartBondAtomic
	const invalidStoredParameters = input.repeatDeposit && (enteredStartBondAtomic <= 0n || enteredStartBondAtomic >= thresholdAtomic)
	const nonDecisionReached = [input.invalidBalance, input.yesBalance, input.noBalance].filter(balance => BigInt(Math.round(balance * Number(atomicScale))) >= thresholdAtomic).length >= 2
	const room = Math.max(0, threshold - input.noBalance)
	const clipped = Math.min(input.proposedDeposit, room)
	const maxBefore = Math.max(input.invalidBalance, input.yesBalance, input.noBalance)
	const tieAdjusted = input.noBalance + clipped === maxBefore && input.noBalance + clipped < threshold
	const clippedAtomic = BigInt(Math.round(clipped * Number(atomicScale)))
	const acceptedAtomicPreview = tieAdjusted && clippedAtomic > 0n ? clippedAtomic - 1n : clippedAtomic
	const noAfterAtomicPreview = BigInt(Math.round(input.noBalance * Number(atomicScale))) + acceptedAtomicPreview
	const previewReverts = invalidStoredParameters || nonDecisionReached || input.noBalance >= threshold || BigInt(Math.round(input.proposedDeposit * Number(atomicScale))) < effectiveStartBondAtomic || (acceptedAtomicPreview < effectiveStartBondAtomic && noAfterAtomicPreview !== thresholdAtomic)
	const acceptedAtomic = previewReverts ? 0n : acceptedAtomicPreview
	const accepted = Number(acceptedAtomic) / Number(atomicScale)
	const noAfterAtomic = BigInt(Math.round(input.noBalance * Number(atomicScale))) + acceptedAtomic
	return { accepted, acceptedAtomic, effectiveStartBondAtomic, noAfter: input.noBalance + accepted, noAfterAtomic, previewReverts, threshold, tieAdjusted }
}

export function calculateResolutionModel(input: { invalidBalance: number; noBalance: number; runningCost: number; yesBalance: number }): { atCost: number; result: 'Invalid' | 'No' | 'None' | 'Yes' } {
	const balances = [input.invalidBalance, input.yesBalance, input.noBalance]
	const atCost = balances.filter(balance => balance >= input.runningCost).length
	const allZero = balances.every(balance => balance === 0)
	const maxBalance = Math.max(...balances)
	const tiedMaximumCount = balances.filter(balance => balance === maxBalance).length
	if (atCost >= 2 || (maxBalance > 0 && tiedMaximumCount >= 2)) return { atCost, result: 'None' }
	if (allZero) return { atCost, result: 'Invalid' }
	if (input.invalidBalance > input.yesBalance && input.invalidBalance > input.noBalance) return { atCost, result: 'Invalid' }
	if (input.yesBalance > input.invalidBalance && input.yesBalance > input.noBalance) return { atCost, result: 'Yes' }
	if (input.noBalance > input.invalidBalance && input.noBalance > input.yesBalance) return { atCost, result: 'No' }
	return { atCost, result: 'None' }
}

export function normalizedEscalationCost(elapsed: number): number {
	return Math.exp(2.4 * (elapsed - 1))
}

export function calculateAnnualizedRetentionFeePercent(utilizationPercent: number): number {
	const maxRetentionRate = 0.999_999_996_848
	const minRetentionRate = 0.999_999_977_88
	const utilizationRatio = Math.min(Math.max(utilizationPercent, 0) / 80, 1)
	const retentionRate = maxRetentionRate - (maxRetentionRate - minRetentionRate) * utilizationRatio
	return (1 - retentionRate ** (365 * 24 * 60 * 60)) * 100
}

export type ForkThresholdPoint = {
	forkThreshold: number
	generation: number
	theoreticalSupply: number
}

export function calculateForkThresholdSeries(generationCount: number, genesisTheoreticalSupply = 100): ForkThresholdPoint[] {
	return Array.from({ length: Math.max(0, generationCount) }, (_, generation) => {
		const theoreticalSupply = genesisTheoreticalSupply * 0.99 ** generation
		return {
			forkThreshold: theoreticalSupply / 20,
			generation,
			theoreticalSupply,
		}
	})
}

export type LiquidationHealthModel = {
	currentRequiredRep: number
	state: 'liquidatable' | 'safe'
	thresholdPrice: number
}

export type ContractInteractionEdge = {
	action: string
	id: string
	phase: string
	receiver: string
	source: string
}

export const contractInteractionEdges: ContractInteractionEdge[] = [
	{ action: 'validate question', id: 'factory-question-validation', phase: 'Deployment', receiver: 'Question Data', source: 'Pool Factory' },
	{ action: 'look up universe', id: 'factory-universe-lookup', phase: 'Deployment', receiver: 'Zoltar', source: 'Pool Factory' },
	{ action: 'deploy pool', id: 'factory-pool-deployment', phase: 'Deployment', receiver: 'Security Pool', source: 'Pool Factory' },
	{ action: 'deploy shares', id: 'factory-share-token-deployment', phase: 'Deployment', receiver: 'Share Token', source: 'Pool Factory' },
	{ action: 'deploy & wire', id: 'factory-price-coordinator-deployment', phase: 'Deployment', receiver: 'Price Coordinator', source: 'Pool Factory' },
	{ action: 'manage REP lifecycle', id: 'zoltar-reputation-token-lifecycle', phase: 'Universe lifecycle', receiver: 'Reputation Token', source: 'Zoltar' },
	{ action: 'mint / burn claims', id: 'pool-share-token-claims', phase: 'Market runtime', receiver: 'Share Token', source: 'Security Pool' },
	{ action: 'escrow REP', id: 'pool-escalation-game-resolution', phase: 'Resolution', receiver: 'Escalation Game', source: 'Security Pool' },
	{ action: 'read cached price', id: 'pool-price-read', phase: 'Risk operations', receiver: 'Price Coordinator', source: 'Security Pool' },
	{ action: 'fund report', id: 'coordinator-oracle-report', phase: 'Price discovery', receiver: 'OpenOracle', source: 'Price Coordinator' },
	{ action: 'settled callback', id: 'oracle-coordinator-callback', phase: 'Price settlement', receiver: 'Price Coordinator', source: 'OpenOracle' },
	{ action: 'execute guarded op', id: 'coordinator-pool-execute', phase: 'Risk execution', receiver: 'Security Pool', source: 'Price Coordinator' },
	{ action: 'request child', id: 'share-token-forker-migration', phase: 'Share migration', receiver: 'Pool Forker', source: 'Share Token' },
	{ action: 'snapshot game', id: 'forker-escalation-snapshot', phase: 'Fork snapshot', receiver: 'Escalation Game', source: 'Pool Forker' },
	{ action: 'migrate REP', id: 'forker-migration-proxy', phase: 'Fork migration', receiver: 'Migration Proxy', source: 'Pool Forker' },
	{ action: 'lock & split REP', id: 'migration-proxy-zoltar', phase: 'Fork migration', receiver: 'Zoltar', source: 'Migration Proxy' },
	{ action: 'deploy child', id: 'forker-child-deployment', phase: 'Fork migration', receiver: 'Pool Factory', source: 'Pool Forker' },
	{ action: 'migrate state', id: 'forker-pool-migration', phase: 'Fork migration', receiver: 'Security Pool', source: 'Pool Forker' },
	{ action: 'repair backing', id: 'forker-truth-auction', phase: 'Backing repair', receiver: 'Truth Auction', source: 'Pool Forker' },
]

export function calculateLiquidationHealth(unlockedRep: number, allowance: number, multiplier: number, currentPrice: number): LiquidationHealthModel {
	const currentRequiredRep = allowance * multiplier * currentPrice
	const thresholdPrice = allowance > 0 && multiplier > 0 ? unlockedRep / (allowance * multiplier) : Number.POSITIVE_INFINITY
	return {
		currentRequiredRep,
		state: currentRequiredRep > unlockedRep ? 'liquidatable' : 'safe',
		thresholdPrice,
	}
}
