import { securityPoolAuctionClaimBatch } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { collateralSpendContinuation } from './collateral-approval.ts'
import { erc20Abi, securityPoolCapitalLedgerAbi, securityPoolRepairAuctionAbi, securityPoolForkCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'
import { erc20WalletDebit, erc20AllowanceEvidence, amount, choose, eligible, encodeStep, mixSeed, optionAmount, planBase } from '../planning.ts'
import { inputInteger, inputMatches } from '../input-values.ts'
import { timestampDeadlineHasRequiredSafety } from '../timing.ts'
import type { AuctionSnapshot, EcosystemSnapshot, OperationDefinition, PlanningOptions } from '../types.ts'

function bidTerms(snapshot: EcosystemSnapshot, options: PlanningOptions, auction: AuctionSnapshot) {
	if (auction.collateralToken.toLowerCase() !== snapshot.deployments.weth.toLowerCase()) return undefined
	if (!inputMatches(options, 'auction', auction.address) || options.allowHighRisk !== true || !auction.opened || auction.finalized || !timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), amount(auction.endTime), options)) return undefined
	const lot = amount(auction.lotAttoEth)
	const grid = amount(auction.repGrid)
	if (lot === 0n || grid === 0n) return undefined
	const lots = inputInteger(options, 'lots', 1n, 1n)
	// Winning lots arrive at the protocol floor; the owner sets its health target on the ledger afterwards.
	const required = amount(auction.unroundedCollateralAttoRepPerLot)
	const minimum = inputInteger(options, 'minimumAttoRepPerLot', ((required + grid - 1n) / grid) * grid, 1n)
	const value = lots * lot
	if (
		minimum < required ||
		minimum % grid !== 0n ||
		minimum > amount(auction.maximumBidAttoRepPerLot) ||
		minimum > amount(auction.maximumAdmissibleBidAttoRepPerLot) ||
		value > optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n) ||
		amount(auction.walletCollateral) < value ||
		amount(snapshot.wallet.ethBalanceAttoEth) < optionAmount(options, 'minimumEthReserveAttoEth', 10n ** 16n)
	)
		return undefined
	return { lots, minimum, value }
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
	const definition: OperationDefinition = {
		id,
		label: 'Bid in security pool collateral repair auction',
		method: 'submitBid',
		contract: 'SecurityPoolRepairAuction',
		classification: 'selectable',
		ecosystem: 'statoblast',
		risk: 'high',
		description: 'Bids whole WETH lots for uniformly priced REP-backed lots that join the wallet’s own capital account at the protocol floor once the bid is claimed.',
		discoveryInputs: ['security pool auction', 'collateral lot and REP price grid', 'wallet WETH and ETH gas reserve'],
		evaluate: (snapshot, options) => eligible(candidates(snapshot, options).length > 0 ? undefined : 'No affordable open auction or high-risk operations disabled'),
		buildPlan(snapshot, options) {
			const candidate = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			if (candidate === undefined) return undefined
			const { auction, terms } = candidate
			return planBase({
				definitionId: id,
				ecosystem: 'statoblast',
				label: 'Bid in security pool collateral repair auction',
				metadata: { auction: auction.address, lots: terms.lots.toString(), minimumAttoRepPerLot: terms.minimum.toString(), collateralToken: auction.collateralToken, collateralSpender: auction.address, collateralBudget: terms.value.toString() },
				deadlineTimestamp: auction.endTime,
				postconditions: ['The engine records a funded bid for the wallet'],
				risk: 'high',
				snapshot,
				maximumCleanupTransactionCount: 1,
				steps: [
					...(amount(auction.collateralAllowance) < terms.value
						? [
								encodeStep({
									abi: erc20Abi,
									args: [auction.address, terms.value],
									functionName: 'approve',
									id: 'approve-auction-collateral',
									label: 'Approve auction collateral',
									to: auction.collateralToken,
									evidence: [erc20AllowanceEvidence(auction.collateralToken, snapshot.wallet.address, auction.address, terms.value)],
								}),
							]
						: []),
					encodeStep({ abi: securityPoolRepairAuctionAbi, args: [terms.lots, terms.minimum], functionName: 'submitBid', id: 'bid', label: 'Bid collateral lots', to: auction.address, value: 0n, walletAssetDebits: [erc20WalletDebit(auction.collateralToken, terms.value, 'weth')] }),
				],
			})
		},
		buildContinuationPlan(snapshot, options, context) {
			return collateralSpendContinuation({ snapshot, options, context, buildPlan: definition.buildPlan, approvalId: 'approve-auction-collateral', actionId: 'bid', label: 'Revoke auction collateral approval', risk: 'high' })
		},
	}
	return definition
}

type LifecycleKind = 'open' | 'finalize' | 'settle' | 'early-refund' | 'withdraw'
function auctionLifecycle(kind: LifecycleKind): OperationDefinition {
	const id = { open: 'statoblast.auction.start', finalize: 'statoblast.auction.finalize-route', settle: 'statoblast.auction.settle-bids', 'early-refund': 'statoblast.auction.refund', withdraw: 'statoblast.auction.withdraw-refund' }[kind]
	const method = { open: 'open', finalize: 'finalizeBranch', settle: 'settleRefund', 'early-refund': 'settleRefund', withdraw: 'withdrawRefunds' }[kind]
	const label = { open: 'Open security pool collateral repair auction', finalize: 'Finalize security pool branch auction', settle: 'Settle auction bid refund', 'early-refund': 'Refund provably losing bid', withdraw: 'Withdraw auction collateral refund' }[kind]
	function candidates(snapshot: EcosystemSnapshot, options?: PlanningOptions) {
		const now = amount(snapshot.anchor.timestamp)
		return snapshot.auctions.flatMap<{ auction: AuctionSnapshot; bidId: string | undefined }>(auction => {
			if (options !== undefined && !inputMatches(options, 'auction', auction.address)) return []
			if (kind === 'settle' || kind === 'early-refund') return auction.finalized === (kind === 'settle') ? auction.refundableBidIds.map(bidId => ({ auction, bidId })) : []
			let enabled = amount(auction.pendingEthRefund) > 0n && auction.pendingEthRefundGeneration !== undefined
			if (kind === 'open') enabled = auction.openingExpectedSuccess && !auction.opened && !auction.finalized && now + 86_400n <= amount(auction.endTime)
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
			steps: [encodeStep({ abi: kind === 'finalize' ? securityPoolForkCoordinatorAbi : securityPoolRepairAuctionAbi, args, functionName: method, id: method, label, to: kind === 'finalize' ? auction.forkController : auction.address })],
		})
	}
	return {
		id,
		label,
		method,
		contract: kind === 'finalize' ? 'SecurityPoolForkCoordinator' : 'SecurityPoolRepairAuction',
		classification: 'lifecycle-obligation',
		ecosystem: 'statoblast',
		risk: 'low',
		description: `${label} without scanning on-chain bids or question vaults.`,
		discoveryInputs: ['security pool branch auction', 'authenticated wallet bids and refunds', 'anchored refund simulation'],
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

/**
 * Claims the wallet's claimable bids in one transaction: winning lots join its capital account and every claimed bid,
 * winning or not, stops blocking the wallet's fork choice in a later fork of this universe.
 */
function claimAuctionBidsDefinition(): OperationDefinition {
	const id = 'statoblast.auction.claim-bids'
	const label = 'Claim repair auction bids'
	function candidates(snapshot: EcosystemSnapshot, options?: PlanningOptions) {
		return snapshot.auctions.filter(auction => auction.claimableBidIds.length > 0 && (options === undefined || inputMatches(options, 'auction', auction.address)))
	}
	// One claim transaction carries at most one SDK batch, so it fits in a block; the operation repeats for the rest.
	const batch = (auction: AuctionSnapshot) => securityPoolAuctionClaimBatch(auction.claimableBidIds.map(bidId => amount(bidId))).bidIds
	const metadata = (auction: AuctionSnapshot) => ({ auction: auction.address, capital: auction.capital, bidIds: batch(auction).join(',') })
	function build(snapshot: EcosystemSnapshot, auction: AuctionSnapshot) {
		return planBase({
			definitionId: id,
			ecosystem: 'statoblast',
			label,
			metadata: metadata(auction),
			postconditions: ['The capital ledger marks each listed bid claimed and moves winning lots into the wallet account'],
			priority: 'urgent',
			risk: 'low',
			snapshot,
			steps: [encodeStep({ abi: securityPoolCapitalLedgerAbi, args: [batch(auction)], functionName: 'materializeRepairAuctionBids', id: 'materializeRepairAuctionBids', label, to: auction.capital })],
		})
	}
	return {
		id,
		label,
		method: 'materializeRepairAuctionBids',
		contract: 'SecurityPoolCapitalLedger',
		classification: 'lifecycle-obligation',
		ecosystem: 'statoblast',
		risk: 'low',
		description: `${label} without scanning on-chain bids.`,
		discoveryInputs: ['security pool branch auction', 'authenticated wallet bids', 'anchored claim simulation'],
		evaluate: (snapshot, options) => eligible(candidates(snapshot, options).length > 0 ? undefined : 'No claimable auction bids'),
		buildPlan(snapshot, options) {
			const auction = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			return auction === undefined ? undefined : build(snapshot, auction)
		},
		buildLifecyclePlans: (snapshot, options) => candidates(snapshot, options).map(auction => build(snapshot, auction)),
		enumerateLifecyclePresence: snapshot => candidates(snapshot).map(metadata),
		enumerateLifecycleObstructingPresence: (snapshot, options) => candidates(snapshot, options).map(metadata),
	}
}

export const claimAuctionBids = claimAuctionBidsDefinition()
export const startCollateralRepairAuction = auctionLifecycle('open')
export const finalizeCollateralRepairAuctionRoute = auctionLifecycle('finalize')
export const settleAuctionBids = auctionLifecycle('settle')
export const refundLosingAuctionBids = auctionLifecycle('early-refund')
