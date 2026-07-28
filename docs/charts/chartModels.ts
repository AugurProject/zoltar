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

export function calculateEscalationDepositModel(input: { invalidBalance: number; noBalance: number; nonDecisionThreshold: number; proposedDeposit: number; startBond: number; yesBalance: number }): {
	accepted: number
	acceptedAtomic: bigint
	noAfter: number
	noAfterAtomic: bigint
	previewReverts: boolean
	threshold: number
	tieAdjusted: boolean
} {
	const threshold = Math.max(input.nonDecisionThreshold, 1)
	const invalidStartParameters = input.startBond >= threshold
	const room = Math.max(0, threshold - input.noBalance)
	const clipped = Math.min(input.proposedDeposit, room)
	const maxBefore = Math.max(input.invalidBalance, input.yesBalance, input.noBalance)
	const tieAdjusted = input.noBalance + clipped === maxBefore && input.noBalance + clipped < threshold
	const clippedAtomic = BigInt(Math.round(clipped * Number(atomicScale)))
	const acceptedAtomicPreview = tieAdjusted && clippedAtomic > 0n ? clippedAtomic - 1n : clippedAtomic
	const noAfterAtomicPreview = BigInt(Math.round(input.noBalance * Number(atomicScale))) + acceptedAtomicPreview
	const previewReverts = invalidStartParameters || input.noBalance >= threshold || input.proposedDeposit < input.startBond || (acceptedAtomicPreview < BigInt(Math.round(input.startBond * Number(atomicScale))) && noAfterAtomicPreview !== BigInt(Math.round(threshold * Number(atomicScale))))
	const acceptedAtomic = previewReverts ? 0n : acceptedAtomicPreview
	const accepted = Number(acceptedAtomic) / Number(atomicScale)
	const noAfterAtomic = BigInt(Math.round(input.noBalance * Number(atomicScale))) + acceptedAtomic
	return { accepted, acceptedAtomic, noAfter: input.noBalance + accepted, noAfterAtomic, previewReverts, threshold, tieAdjusted }
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
