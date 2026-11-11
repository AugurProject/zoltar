import { securityPoolPortfolioAuctionAbi, securityPoolPortfolioForkCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'
import { amount, choose, eligible, encodeStep, mixSeed, optionAmount, planBase } from '../planning.ts'
import { inputInteger, inputMatches } from '../input-values.ts'
import { timestampDeadlineHasRequiredSafety } from '../timing.ts'
import type { AuctionSnapshot, EcosystemSnapshot, OperationDefinition, PlanningOptions } from '../types.ts'

function bidTerms(snapshot: EcosystemSnapshot, options: PlanningOptions, auction: AuctionSnapshot) {
	if (!inputMatches(options, 'auction', auction.address) || options.allowHighRisk !== true || !auction.opened || auction.finalized || !timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), amount(auction.endTime), options)) return undefined
	const lot = amount(auction.lotAttoEth)
	const grid = amount(auction.repGrid)
	if (lot === 0n || grid === 0n) return undefined
	const lots = inputInteger(options, 'lots', 1n, 1n)
	const health = inputInteger(options, 'healthFactorBps', 10_000n, 10_000n)
	const required = (amount(auction.unroundedCollateralAttoRepPerLot) * health + 9_999n) / 10_000n
	const minimum = inputInteger(options, 'minimumAttoRepPerLot', ((required + grid - 1n) / grid) * grid, 1n)
	const value = lots * lot
	if (minimum < required || minimum % grid !== 0n || minimum > amount(auction.maximumBidAttoRepPerLot) || value > optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n) || amount(snapshot.wallet.ethBalanceAttoEth) < value + optionAmount(options, 'minimumEthReserveAttoEth', 10n ** 16n)) return undefined
	return { lots, health, minimum, value }
}

export function auctionDefinition(kind: 'bid' | 'withdraw-refund'): OperationDefinition {
	if (kind === 'withdraw-refund') return auctionLifecycle('withdraw')
	const id = 'statoblast.auction.bid'
	function candidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
		return snapshot.auctions.flatMap(auction => {
			const terms = bidTerms(snapshot, options, auction)
			return terms === undefined ? [] : [{ auction, terms }]
		})
	}
	return {
		id,
		label: 'Bid in portfolio collateral repair auction',
		method: 'submitBid',
		contract: 'SecurityPoolPortfolioAuction',
		classification: 'selectable',
		ecosystem: 'statoblast',
		risk: 'high',
		description: 'Bids whole ETH lots for a uniformly priced REP-backed owner position with a chosen health target.',
		discoveryInputs: ['portfolio auction', 'ETH lot and REP price grid', 'wallet ETH'],
		evaluate: (snapshot, options) => eligible(candidates(snapshot, options).length > 0 ? undefined : 'No affordable open auction or high-risk operations disabled'),
		buildPlan(snapshot, options) {
			const candidate = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			if (candidate === undefined) return undefined
			const { auction, terms } = candidate
			return planBase({
				definitionId: id,
				ecosystem: 'statoblast',
				label: 'Bid in portfolio collateral repair auction',
				metadata: { auction: auction.address, lots: terms.lots.toString(), minimumAttoRepPerLot: terms.minimum.toString(), healthFactorBps: terms.health.toString() },
				deadlineTimestamp: auction.endTime,
				postconditions: ['The engine records a funded bid and its dedicated owner vault'],
				risk: 'high',
				snapshot,
				steps: [encodeStep({ abi: securityPoolPortfolioAuctionAbi, args: [terms.lots, terms.minimum, terms.health], functionName: 'submitBid', id: 'bid', label: 'Bid ETH lots', to: auction.address, value: terms.value })],
			})
		},
	}
}

type LifecycleKind = 'open' | 'finalize' | 'settle' | 'early-refund' | 'withdraw'
function auctionLifecycle(kind: LifecycleKind): OperationDefinition {
	const id = { open: 'statoblast.auction.start', finalize: 'statoblast.auction.finalize-route', settle: 'statoblast.auction.settle-bids', 'early-refund': 'statoblast.auction.refund', withdraw: 'statoblast.auction.withdraw-refund' }[kind]
	const method = { open: 'open', finalize: 'finalizeBranch', settle: 'settleRefund', 'early-refund': 'settleRefund', withdraw: 'withdrawRefunds' }[kind]
	const label = { open: 'Open portfolio collateral repair auction', finalize: 'Finalize portfolio branch auction', settle: 'Settle auction bid refund', 'early-refund': 'Refund provably losing bid', withdraw: 'Withdraw auction ETH refund' }[kind]
	function candidates(snapshot: EcosystemSnapshot, options?: PlanningOptions) {
		const now = amount(snapshot.anchor.timestamp)
		return snapshot.auctions.flatMap<{ auction: AuctionSnapshot; bidId: string | undefined }>(auction => {
			if (options !== undefined && !inputMatches(options, 'auction', auction.address)) return []
			if (kind === 'settle' || kind === 'early-refund') return auction.finalized === (kind === 'settle') ? auction.refundableBidIds.map(bidId => ({ auction, bidId })) : []
			let enabled = amount(auction.pendingEthRefund) > 0n && auction.pendingEthRefundGeneration !== undefined
			if (kind === 'open') enabled = !auction.opened && !auction.finalized && now < amount(auction.endTime)
			if (kind === 'finalize') enabled = !auction.finalized && now >= amount(auction.endTime)
			return enabled ? [{ auction, bidId: undefined }] : []
		})
	}
	function metadata(candidate: { auction: AuctionSnapshot; bidId: string | undefined }) {
		return { auction: candidate.auction.address, ...(candidate.bidId === undefined ? {} : { bidId: candidate.bidId }), ...(kind === 'withdraw' && candidate.auction.pendingEthRefundGeneration !== undefined ? { refundGeneration: candidate.auction.pendingEthRefundGeneration } : {}) }
	}
	function build(snapshot: EcosystemSnapshot, candidate: { auction: AuctionSnapshot; bidId: string | undefined }) {
		const { auction, bidId } = candidate
		let args: (bigint | string)[] = bidId === undefined ? [] : [amount(bidId)]
		if (kind === 'withdraw') args = [snapshot.wallet.address]
		if (kind === 'finalize') args = [amount(auction.universeId)]
		return planBase({
			definitionId: id,
			ecosystem: 'statoblast',
			label,
			metadata: metadata(candidate),
			postconditions: [label],
			priority: 'urgent',
			risk: 'low',
			snapshot,
			steps: [encodeStep({ abi: kind === 'finalize' ? securityPoolPortfolioForkCoordinatorAbi : securityPoolPortfolioAuctionAbi, args, functionName: method, id: method, label, to: kind === 'finalize' ? auction.forkController : auction.address })],
		})
	}
	return {
		id,
		label,
		method,
		contract: kind === 'finalize' ? 'SecurityPoolPortfolioForkCoordinator' : 'SecurityPoolPortfolioAuction',
		classification: 'lifecycle-obligation',
		ecosystem: 'statoblast',
		risk: 'low',
		description: `${label} without scanning on-chain bids or question vaults.`,
		discoveryInputs: ['portfolio branch auction', 'authenticated wallet bids and refunds', 'anchored refund simulation'],
		evaluate: (snapshot, options) => eligible(candidates(snapshot, options).length > 0 ? undefined : 'No eligible auction lifecycle work'),
		buildPlan(snapshot, options) {
			const candidate = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			return candidate === undefined ? undefined : build(snapshot, candidate)
		},
		buildLifecyclePlans: (snapshot, options) => candidates(snapshot, options).map(candidate => build(snapshot, candidate)),
		enumerateLifecyclePresence: snapshot => candidates(snapshot).map(metadata),
		enumerateLifecycleObstructingPresence: (snapshot, options) => candidates(snapshot, options).map(metadata),
	}
}

export const startCollateralRepairAuction = auctionLifecycle('open')
export const finalizeCollateralRepairAuctionRoute = auctionLifecycle('finalize')
export const settleAuctionBids = auctionLifecycle('settle')
export const refundLosingAuctionBids = auctionLifecycle('early-refund')
