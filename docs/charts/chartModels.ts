import { computeEscalationBindingCapitalAttoRep, computeEscalationTimeSinceStartFromAttritionCostAttoRep, ESCALATION_TIME_LENGTH, hasReachedNonDecision, type EscalationBalanceTuple, type EscalationOutcomeKey, projectEscalationDeposit } from '../../shared/ts/escalationMath'

export type AuctionBidInput = {
	eth: number
	key: 'alice' | 'bob' | 'carol'
	name: string
	price: number
}

export const quantitativeChartIds = ['fig-auction-clearing-ladder', 'fig-statoblast-escalation-cost-curve', 'fig-statoblast-retention-utilization', 'fig-zoltar-fork-threshold-decay', 'plot-statoblast-whitepaper-19'] as const

type QuantitativeChartId = (typeof quantitativeChartIds)[number]

export const quantitativeChartAxisLabels: Record<QuantitativeChartId, { x: string; y: string }> = {
	'fig-auction-clearing-ladder': { x: 'Cumulative REP demand (REP)', y: 'Bid limit (ETH/REP)' },
	'fig-statoblast-escalation-cost-curve': { x: 'Days since game start (days)', y: 'Required support threshold / attrition cost (REP)' },
	'fig-statoblast-retention-utilization': { x: 'Live ETH minting-capacity utilization (%)', y: 'Annualized open-interest fee (%)' },
	'fig-zoltar-fork-threshold-decay': { x: 'Fork generation (count)', y: 'Theoretical genesis supply (%)' },
	'plot-statoblast-whitepaper-19': { x: 'Child-universe collateral (ETH)', y: 'Collateral destination (category)' },
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
	let accumulatedBidEth = 0
	let clearingPrice = 0
	let ethFilledAtClearing = 0
	let funded = false
	let lastValidPrice = 0
	let lastValidEthAtTick = 0
	const demandPoints: AuctionModel['demandPoints'] = []
	const chartRepByKey = new Map<AuctionBidInput['key'], number>()
	for (const tick of ticks) {
		if (accumulatedBidEth > 0 && accumulatedBidEth / tick.price > repInventory) {
			funded = true
			clearingPrice = lastValidPrice
			ethFilledAtClearing = lastValidEthAtTick
			break
		}
		const ethToTake = Math.min(tick.totalEth, Math.max(0, ethRaiseCap - accumulatedBidEth))
		const newAccumulatedEth = accumulatedBidEth + ethToTake
		const candidateRep = newAccumulatedEth / tick.price
		demandPoints.push({ cumulativeRep: candidateRep, price: tick.price })
		for (const bid of tick.bids) {
			chartRepByKey.set(bid.key, candidateRep)
		}
		if (candidateRep >= repInventory) {
			funded = true
			clearingPrice = tick.price
			ethFilledAtClearing = Math.max(0, Math.min(ethToTake, repInventory * tick.price - accumulatedBidEth))
			accumulatedBidEth += ethFilledAtClearing
			break
		}
		if (newAccumulatedEth >= ethRaiseCap) {
			funded = true
			clearingPrice = tick.price
			ethFilledAtClearing = ethToTake
			accumulatedBidEth = newAccumulatedEth
			break
		}
		accumulatedBidEth = newAccumulatedEth
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
		const winningEthAmount = activeBids.reduce((sum, bid) => sum + bid.eth, 0)
		accumulatedBidEth = winningEthAmount
		if (winningEthAmount > 0) {
			for (const bid of activeBids) {
				repByKey.set(bid.key, (bid.eth * repInventory) / winningEthAmount)
			}
		}
		clearingPrice = qualificationPrice
		effectivePrice = winningEthAmount > 0 ? winningEthAmount / repInventory : 0
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
		ethRaised: accumulatedBidEth,
		mode: funded ? 'uniform' : 'underfunded',
		qualificationPrice,
	}
}

export function calculateCollateralRepairModel(
	parentSettlementCollateral: number,
	forkSettlementCollateralReceived: number,
	auctionRaised: number,
): {
	initialShortfall: number
	received: number
	remainingShortfall: number
	repairEth: number
} {
	const received = Math.min(Math.max(forkSettlementCollateralReceived, 0), Math.max(parentSettlementCollateral, 0))
	const initialShortfall = Math.max(0, parentSettlementCollateral - received)
	const repairEth = Math.min(Math.max(auctionRaised, 0), initialShortfall)
	return {
		initialShortfall,
		received,
		remainingShortfall: initialShortfall - repairEth,
		repairEth,
	}
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

export const ESCALATION_ACTIVATION_DELAY_DAYS = 3
export const ESCALATION_TIME_LENGTH_DAYS = Number(ESCALATION_TIME_LENGTH) / 86_400
export const ESCALATION_TIME_LENGTH_SECONDS = ESCALATION_TIME_LENGTH

const ATTO_REP = 10n ** 18n

export function toAttoRep(value: number) {
	return BigInt(Math.round(value * 1_000_000)) * 1_000_000_000_000n
}

export function computeCanonicalEscalationBindingCapital(startBondRep: number, nonDecisionThresholdRep: number, elapsedDays: number) {
	const elapsedSeconds = BigInt(Math.round(Math.max(0, elapsedDays - ESCALATION_ACTIVATION_DELAY_DAYS) * 86_400))
	return Number(computeEscalationBindingCapitalAttoRep(toAttoRep(startBondRep), toAttoRep(nonDecisionThresholdRep), elapsedSeconds)) / Number(ATTO_REP)
}

export function computeCanonicalEscalationDeadlineDays(startBondRep: number, nonDecisionThresholdRep: number, bindingCapitalRep: number) {
	const startBondAttoRep = toAttoRep(startBondRep)
	const thresholdAttoRep = toAttoRep(nonDecisionThresholdRep)
	const bindingCapitalAttoRep = toAttoRep(bindingCapitalRep)
	if (bindingCapitalAttoRep <= startBondAttoRep) return ESCALATION_ACTIVATION_DELAY_DAYS
	if (bindingCapitalAttoRep >= thresholdAttoRep) return ESCALATION_ACTIVATION_DELAY_DAYS + ESCALATION_TIME_LENGTH_DAYS
	const elapsedSeconds = computeEscalationTimeSinceStartFromAttritionCostAttoRep(startBondAttoRep, thresholdAttoRep, bindingCapitalAttoRep)
	return ESCALATION_ACTIVATION_DELAY_DAYS + Number(elapsedSeconds) / 86_400
}

export function projectDocumentationEscalationDeposit(input: { amountRep: number; balances: EscalationBalanceTuple; nonDecisionThresholdRep: number; outcome: EscalationOutcomeKey; startBondRep: number }) {
	return projectEscalationDeposit({
		amountAttoRep: toAttoRep(input.amountRep),
		balancesAttoRep: input.balances,
		nonDecisionThresholdAttoRep: toAttoRep(input.nonDecisionThresholdRep),
		outcome: input.outcome,
		startBondAttoRep: toAttoRep(input.startBondRep),
	})
}

export function calculateEscalationDepositModel(input: { invalidBalance: number; noBalance: number; nonDecisionThreshold: number; proposedDeposit: number; repeatDeposit: boolean; startBond: number; yesBalance: number }) {
	const threshold = Math.max(input.nonDecisionThreshold, 1)
	const thresholdAttoRep = toAttoRep(threshold)
	const enteredStartBondAttoRep = toAttoRep(input.startBond)
	const effectiveStartBondAttoRep = !input.repeatDeposit && enteredStartBondAttoRep >= thresholdAttoRep ? thresholdAttoRep - 1n : enteredStartBondAttoRep
	const invalidStoredParameters = input.repeatDeposit && (enteredStartBondAttoRep <= 0n || enteredStartBondAttoRep >= thresholdAttoRep)
	const projection = projectEscalationDeposit({ amountAttoRep: toAttoRep(input.proposedDeposit), balancesAttoRep: [toAttoRep(input.invalidBalance), toAttoRep(input.yesBalance), toAttoRep(input.noBalance)], nonDecisionThresholdAttoRep: thresholdAttoRep, outcome: 'no', startBondAttoRep: effectiveStartBondAttoRep })
	const previewReverts = invalidStoredParameters || hasReachedNonDecision([toAttoRep(input.invalidBalance), toAttoRep(input.yesBalance), toAttoRep(input.noBalance)], thresholdAttoRep) || projection === undefined
	const acceptedAttoRep = previewReverts ? 0n : projection.acceptedAmountAttoRep
	return { accepted: Number(acceptedAttoRep) / Number(ATTO_REP), acceptedAttoRep, effectiveStartBondAttoRep, noAfter: input.noBalance + Number(acceptedAttoRep) / Number(ATTO_REP), noAfterAttoRep: toAttoRep(input.noBalance) + acceptedAttoRep, previewReverts, threshold, tieAdjusted: projection?.tieAdjusted ?? false }
}

export function calculateAnnualizedRetentionFeePercent(utilizationPercent: number): number {
	const maxRetentionRate = 0.999_999_996_848
	const minRetentionRate = 0.999_999_977_88
	const utilizationRatio = Math.min(Math.max(utilizationPercent, 0) / 80, 1)
	const retentionRate = maxRetentionRate - (maxRetentionRate - minRetentionRate) * utilizationRatio
	return (1 - retentionRate ** (365 * 24 * 60 * 60)) * 100
}

export type ForkThresholdPoint = {
	forkThresholdRep: number
	generation: number
	theoreticalSupply: number
}

export function calculateForkThresholdSeries(generationCount: number, genesisTheoreticalSupply = 100): ForkThresholdPoint[] {
	return Array.from({ length: Math.max(0, generationCount) }, (_, generation) => {
		const theoreticalSupply = genesisTheoreticalSupply * 0.99 ** generation
		return {
			forkThresholdRep: theoreticalSupply / 20,
			generation,
			theoreticalSupply,
		}
	})
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
