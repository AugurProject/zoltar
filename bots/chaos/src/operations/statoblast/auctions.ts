import { EcosystemSnapshot, OperationDefinition, PlanningOptions, PoolSnapshot } from '../types.ts'

import { amount, choose, eligible, encodeStep, eventEvidence, mixSeed, planBase } from '../planning.ts'

import { inputInteger, inputMatches } from '../input-values.ts'

import { timestampDeadlineHasRequiredSafety } from '../timing.ts'

import { ethSpend } from '../input-funding.ts'

import { securityPoolForkerAbi, uniformPriceDualCapBatchAuctionAbi } from '@zoltar/bot-shared/contracts/abi'

import { zeroAddress } from '@zoltar/bot-shared/ethereum'

import { MIGRATION_TIME_SECONDS, compareAuctionBids, lifecycleBatches } from './planning.ts'

import { walletVaultRegistrationCapacityBlocker } from './vaults.ts'

export function auctionDefinition(kind: 'bid' | 'withdraw-refund'): OperationDefinition {
	const id = `statoblast.auction.${kind}`
	const method = kind === 'bid' ? 'submitBid' : 'withdrawPendingEthRefund'
	const candidates = (snapshot: EcosystemSnapshot, options: PlanningOptions) => {
		const now = amount(snapshot.anchor.timestamp)
		return snapshot.auctions
			.filter(candidate => inputMatches(options, 'auction', candidate.address))
			.filter(candidate =>
				kind === 'bid'
					? !candidate.finalized && amount(candidate.startTime) > 0n && timestampDeadlineHasRequiredSafety(now, amount(candidate.endTime), options) && ethSpend(snapshot, options, id, amount(candidate.minimumBidAttoEth)) >= amount(candidate.minimumBidAttoEth)
					: amount(candidate.pendingEthRefund) > 0n && candidate.pendingEthRefundGeneration !== undefined,
			)
	}
	const build = (snapshot: EcosystemSnapshot, options: PlanningOptions, auction: EcosystemSnapshot['auctions'][number]) => {
		const bid = kind === 'bid' ? ethSpend(snapshot, options, id, amount(auction.minimumBidAttoEth)) : 0n
		const tick = Number(inputInteger(options, 'tick', BigInt((mixSeed(options.seed, 'auction-tick') % 20_001) - 10_000), -10_000n, 10_000n))
		const signature = kind === 'bid' ? 'BidSubmitted(address,int256,uint256,uint256,uint256)' : 'PendingEthRefundWithdrawn(address,uint256)'
		let metadata: Record<string, string | number | boolean>
		if (kind === 'bid') {
			metadata = { auction: auction.address, bidAttoEth: bid.toString(), pendingRefundBefore: auction.pendingEthRefund, tick }
		} else {
			const refundGeneration = auction.pendingEthRefundGeneration
			if (refundGeneration === undefined) throw new Error(`Auction ${auction.address} pending refund has no authenticated generation`)
			metadata = { auction: auction.address, refundGeneration }
		}
		return planBase({
			deadlineTimestamp: kind === 'bid' ? auction.endTime : undefined,
			definitionId: id,
			ecosystem: 'statoblast',
			label: `Auction ${kind}`,
			metadata,
			postconditions: [kind === 'bid' ? 'Bid is indexed for the wallet at the selected tick' : 'Pending ETH refund becomes zero'],
			priority: kind === 'bid' ? 'random' : 'urgent',
			risk: kind === 'bid' ? 'high' : 'low',
			snapshot,
			steps: [encodeStep({ abi: uniformPriceDualCapBatchAuctionAbi, args: kind === 'bid' ? [tick] : undefined, evidence: [eventEvidence(auction.address, signature)], functionName: method, id: method, label: kind, to: auction.address, value: kind === 'bid' ? bid : undefined })],
		})
	}
	return {
		buildPlan(snapshot, options) {
			const auction = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			return auction === undefined ? undefined : build(snapshot, options, auction)
		},
		buildLifecyclePlans(snapshot, options) {
			return kind === 'withdraw-refund' ? candidates(snapshot, options).map(auction => build(snapshot, options, auction)) : []
		},
		enumerateLifecycleObstructingPresence(snapshot, options) {
			return kind === 'withdraw-refund'
				? candidates(snapshot, options).map(auction => {
						const refundGeneration = auction.pendingEthRefundGeneration
						if (refundGeneration === undefined) throw new Error(`Auction ${auction.address} pending refund has no authenticated generation`)
						return { auction: auction.address, refundGeneration }
					})
				: []
		},
		enumerateLifecyclePresence(snapshot) {
			return kind === 'withdraw-refund'
				? snapshot.auctions.flatMap(auction => {
						const refundGeneration = auction.pendingEthRefundGeneration
						return amount(auction.pendingEthRefund) > 0n && refundGeneration !== undefined ? [{ auction: auction.address, refundGeneration }] : []
					})
				: []
		},
		classification: kind === 'bid' ? 'selectable' : 'lifecycle-obligation',
		contract: 'UniformPriceDualCapBatchAuction',
		description: `${kind} for a discovered truth auction.`,
		discoveryInputs: ['truth auction lifecycle', 'wallet bids/refunds', 'wallet ETH'],
		ecosystem: 'statoblast',
		evaluate(snapshot, options) {
			const now = amount(snapshot.anchor.timestamp)
			const found = snapshot.auctions.some(auction =>
				kind === 'bid'
					? !auction.finalized && amount(auction.startTime) > 0n && timestampDeadlineHasRequiredSafety(now, amount(auction.endTime), options) && ethSpend(snapshot, options, id, amount(auction.minimumBidAttoEth)) >= amount(auction.minimumBidAttoEth)
					: amount(auction.pendingEthRefund) > 0n && auction.pendingEthRefundGeneration !== undefined,
			)
			return eligible(kind === 'bid' && options.allowHighRisk !== true ? 'High-risk operations are disabled' : undefined, found ? undefined : `No auction is eligible to ${kind}`)
		},
		id,
		label: `Auction ${kind}`,
		method,
		risk: kind === 'bid' ? 'high' : 'low',
	}
}

function truthAuctionStartCandidates(snapshot: EcosystemSnapshot) {
	const now = amount(snapshot.anchor.timestamp)
	return snapshot.pools.filter(pool => {
		const auction = snapshot.auctions.find(value => value.pool.toLowerCase() === pool.address.toLowerCase())
		return pool.systemState === 2 && pool.parent !== zeroAddress && auction?.startTime === '0' && amount(pool.parentForkActivationTime) > 0n && now > amount(pool.parentForkActivationTime) + MIGRATION_TIME_SECONDS
	})
}

function buildTruthAuctionStartPlan(snapshot: EcosystemSnapshot, pool: PoolSnapshot) {
	return planBase({
		definitionId: startTruthAuction.id,
		ecosystem: 'statoblast',
		label: startTruthAuction.label,
		metadata: { pool: pool.address },
		postconditions: ['The child leaves migration state and either starts or atomically finalizes its truth auction'],
		priority: 'urgent',
		risk: 'irreversible',
		snapshot,
		steps: [
			encodeStep({
				abi: securityPoolForkerAbi,
				args: [pool.address],
				evidence: [{ abi: 'function systemState() view returns (uint8)', args: [], contract: pool.address, functionName: 'systemState', kind: 'storage-postcondition', relation: 'changed' }],
				functionName: 'startTruthAuction',
				id: 'start-truth-auction',
				label: 'Start truth auction',
				to: snapshot.deployments.securityPoolForker,
			}),
		],
	})
}

export const startTruthAuction: OperationDefinition = {
	buildPlan(snapshot, options) {
		const pool = choose(truthAuctionStartCandidates(snapshot), mixSeed(options.seed, startTruthAuction.id))
		return pool === undefined ? undefined : buildTruthAuctionStartPlan(snapshot, pool)
	},
	buildLifecyclePlans(snapshot) {
		return truthAuctionStartCandidates(snapshot).map(pool => buildTruthAuctionStartPlan(snapshot, pool))
	},
	enumerateLifecycleObstructingPresence(snapshot) {
		return truthAuctionStartCandidates(snapshot).map(pool => ({ pool: pool.address }))
	},
	enumerateLifecyclePresence(snapshot) {
		return truthAuctionStartCandidates(snapshot).map(pool => ({ pool: pool.address }))
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPoolForker',
	description: 'Advances a child pool out of its completed migration window by starting its truth auction route.',
	discoveryInputs: ['child and parent pool relation', 'parent fork activation deadline', 'child system state', 'auction start time'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const now = amount(snapshot.anchor.timestamp)
		const found = snapshot.pools.some(pool => {
			const auction = snapshot.auctions.find(value => value.pool.toLowerCase() === pool.address.toLowerCase())
			return pool.systemState === 2 && pool.parent !== zeroAddress && auction?.startTime === '0' && amount(pool.parentForkActivationTime) > 0n && now > amount(pool.parentForkActivationTime) + MIGRATION_TIME_SECONDS
		})
		return eligible(options.allowIrreversibleOperations === true ? undefined : 'Irreversible operations are disabled', found ? undefined : 'No child pool has completed migration and awaits auction start')
	},
	id: 'statoblast.auction.start',
	label: 'Start truth auction route',
	method: 'startTruthAuction',
	risk: 'irreversible',
}

function truthAuctionFinalizeCandidates(snapshot: EcosystemSnapshot) {
	const now = amount(snapshot.anchor.timestamp)
	return snapshot.auctions.flatMap(auction => {
		const pool = snapshot.pools.find(value => value.address.toLowerCase() === auction.pool.toLowerCase())
		return pool !== undefined && pool.systemState === 3 && !auction.finalized && amount(auction.startTime) > 0n && now > amount(auction.endTime) ? [{ auction, pool }] : []
	})
}

function buildTruthAuctionFinalizePlan(snapshot: EcosystemSnapshot, candidate: ReturnType<typeof truthAuctionFinalizeCandidates>[number]) {
	return planBase({
		definitionId: finalizeTruthAuctionRoute.id,
		ecosystem: 'statoblast',
		label: finalizeTruthAuctionRoute.label,
		metadata: { auction: candidate.auction.address, pool: candidate.pool.address },
		postconditions: ['The forker consumes the auction and restores the child pool to operational state'],
		priority: 'urgent',
		risk: 'low',
		snapshot,
		steps: [
			encodeStep({
				abi: securityPoolForkerAbi,
				args: [candidate.pool.address],
				evidence: [eventEvidence(snapshot.deployments.securityPoolForker, 'TruthAuctionFinalized(address)')],
				functionName: 'finalizeTruthAuction',
				id: 'finalize-truth-auction-route',
				label: 'Finalize truth auction route',
				to: snapshot.deployments.securityPoolForker,
			}),
		],
	})
}

export const finalizeTruthAuctionRoute: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(truthAuctionFinalizeCandidates(snapshot), mixSeed(options.seed, finalizeTruthAuctionRoute.id))
		return candidate === undefined ? undefined : buildTruthAuctionFinalizePlan(snapshot, candidate)
	},
	buildLifecyclePlans(snapshot) {
		return truthAuctionFinalizeCandidates(snapshot).map(candidate => buildTruthAuctionFinalizePlan(snapshot, candidate))
	},
	enumerateLifecycleObstructingPresence(snapshot) {
		return truthAuctionFinalizeCandidates(snapshot).map(candidate => ({ auction: candidate.auction.address, pool: candidate.pool.address }))
	},
	enumerateLifecyclePresence(snapshot) {
		return truthAuctionFinalizeCandidates(snapshot).map(candidate => ({ auction: candidate.auction.address, pool: candidate.pool.address }))
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPoolForker',
	description: 'Finalizes an elapsed forker-owned truth auction and reconciles the child pool accounting atomically.',
	discoveryInputs: ['child system state', 'auction start/end/finalization state', 'anchor timestamp'],
	ecosystem: 'statoblast',
	evaluate(snapshot) {
		const now = amount(snapshot.anchor.timestamp)
		const found = snapshot.auctions.some(auction => {
			const pool = snapshot.pools.find(value => value.address.toLowerCase() === auction.pool.toLowerCase())
			return pool !== undefined && pool.systemState === 3 && !auction.finalized && amount(auction.startTime) > 0n && now > amount(auction.endTime)
		})
		return eligible(found ? undefined : 'No elapsed truth auction route is ready to finalize')
	},
	id: 'statoblast.auction.finalize-route',
	label: 'Finalize truth auction route',
	method: 'finalizeTruthAuction',
	risk: 'low',
}

function finalizedAuctionBidCanCreditVault(auction: EcosystemSnapshot['auctions'][number], bid: EcosystemSnapshot['auctions'][number]['bids'][number]) {
	if (BigInt(bid.tick) < BigInt(auction.clearingTick)) return false
	return !auction.underfunded || amount(auction.underfundedWinningAttoEth) > 0n
}

function finalizedAuctionBidCandidates(snapshot: EcosystemSnapshot, options?: PlanningOptions) {
	return snapshot.auctions.flatMap(auction => {
		const pool = snapshot.pools.find(value => value.address.toLowerCase() === auction.pool.toLowerCase())
		if (!auction.finalized || pool === undefined) return []
		const bids = auction.bids.filter(bid => !bid.refunded).sort(compareAuctionBids)
		const batches = [...lifecycleBatches(bids.filter(bid => !finalizedAuctionBidCanCreditVault(auction, bid))), ...lifecycleBatches(bids.filter(bid => finalizedAuctionBidCanCreditVault(auction, bid)))]
		return batches.flatMap(batch => {
			const canCreditVault = batch.some(bid => finalizedAuctionBidCanCreditVault(auction, bid))
			if (options !== undefined && canCreditVault && walletVaultRegistrationCapacityBlocker(pool, options, 'Winning auction settlement vault registration') !== undefined) return []
			return [{ auction, bids: batch, pool }]
		})
	})
}

function finalizedAuctionBidMetadata(candidate: ReturnType<typeof finalizedAuctionBidCandidates>[number]) {
	return {
		auction: candidate.auction.address,
		bidCount: candidate.bids.length,
		bidKeys: candidate.bids
			.map(bid => `${bid.tick}:${bid.index}`)
			.sort()
			.join(','),
		pool: candidate.pool.address,
	}
}

function buildSettleAuctionBidsPlan(snapshot: EcosystemSnapshot, candidate: ReturnType<typeof finalizedAuctionBidCandidates>[number]) {
	const tickIndices = candidate.bids.map(bid => ({ bidIndex: BigInt(bid.index), tick: BigInt(bid.tick) }))
	return planBase({
		definitionId: settleAuctionBids.id,
		ecosystem: 'statoblast',
		label: settleAuctionBids.label,
		metadata: finalizedAuctionBidMetadata(candidate),
		postconditions: ['Every selected wallet bid emits BidSettled and is pruned from the durable index'],
		priority: 'urgent',
		risk: 'low',
		snapshot,
		steps: [
			encodeStep({
				abi: securityPoolForkerAbi,
				args: [candidate.pool.address, snapshot.wallet.address, tickIndices, []],
				evidence: [eventEvidence(candidate.auction.address, 'BidSettled(address,int256,uint256,uint256,uint256,uint256,uint256,uint8)')],
				functionName: 'settleAuctionBids',
				id: 'settle-auction-bids',
				label: 'Settle wallet auction bids',
				to: snapshot.deployments.securityPoolForker,
			}),
		],
	})
}

export const settleAuctionBids: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(finalizedAuctionBidCandidates(snapshot, options), mixSeed(options.seed, settleAuctionBids.id))
		return candidate === undefined ? undefined : buildSettleAuctionBidsPlan(snapshot, candidate)
	},
	buildLifecyclePlans(snapshot, options) {
		return finalizedAuctionBidCandidates(snapshot, options).map(candidate => buildSettleAuctionBidsPlan(snapshot, candidate))
	},
	enumerateLifecycleObstructingPresence(snapshot) {
		return finalizedAuctionBidCandidates(snapshot).map(finalizedAuctionBidMetadata)
	},
	enumerateLifecyclePresence(snapshot) {
		return finalizedAuctionBidCandidates(snapshot).map(finalizedAuctionBidMetadata)
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPoolForker',
	description: 'Settles all canonically indexed wallet bids after the forker-owned auction finalizes.',
	discoveryInputs: ['canonical wallet bid index', 'auction finalization state', 'pool/auction route'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const obstructing = finalizedAuctionBidCandidates(snapshot)
		const actionable = finalizedAuctionBidCandidates(snapshot, options)
		const firstWinning = obstructing.find(candidate => candidate.bids.some(bid => finalizedAuctionBidCanCreditVault(candidate.auction, bid)))
		const capacityBlocker = firstWinning === undefined || actionable.length > 0 ? undefined : walletVaultRegistrationCapacityBlocker(firstWinning.pool, options, 'Winning auction settlement vault registration')
		return eligible(capacityBlocker, obstructing.length > 0 ? undefined : 'No finalized indexed wallet bid remains unsettled')
	},
	id: 'statoblast.auction.settle-bids',
	label: 'Settle auction bids',
	method: 'settleAuctionBids',
	risk: 'low',
}

function refundableAuctionCandidates(snapshot: EcosystemSnapshot) {
	return snapshot.auctions.flatMap(auction => {
		if (auction.finalized || !auction.hasClearingPrice) return []
		return auction.bids
			.filter(bid => !bid.refunded && BigInt(bid.tick) < BigInt(auction.clearingTick))
			.sort(compareAuctionBids)
			.map(bid => ({ auction, bid }))
	})
}

function buildAuctionRefundPlan(snapshot: EcosystemSnapshot, candidate: ReturnType<typeof refundableAuctionCandidates>[number]) {
	const refundable = [{ bidIndex: BigInt(candidate.bid.index), tick: BigInt(candidate.bid.tick) }]
	return planBase({
		definitionId: refundLosingAuctionBids.id,
		ecosystem: 'statoblast',
		label: refundLosingAuctionBids.label,
		metadata: { auction: candidate.auction.address, bidIndex: candidate.bid.index, tick: candidate.bid.tick },
		postconditions: ['The selected losing bid emits BidSettled and becomes unavailable in the canonical index'],
		priority: 'urgent',
		risk: 'low',
		snapshot,
		steps: [
			encodeStep({
				abi: uniformPriceDualCapBatchAuctionAbi,
				args: [refundable],
				evidence: [eventEvidence(candidate.auction.address, 'BidSettled(address,int256,uint256,uint256,uint256,uint256,uint256,uint8)')],
				functionName: 'refundLosingBids',
				id: `refund-losing-bid-${candidate.bid.tick}-${candidate.bid.index}`,
				label: 'Refund losing auction bid',
				to: candidate.auction.address,
			}),
		],
	})
}

export const refundLosingAuctionBids: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(refundableAuctionCandidates(snapshot), mixSeed(options.seed, refundLosingAuctionBids.id))
		return candidate === undefined ? undefined : buildAuctionRefundPlan(snapshot, candidate)
	},
	buildLifecyclePlans(snapshot) {
		return refundableAuctionCandidates(snapshot).map(candidate => buildAuctionRefundPlan(snapshot, candidate))
	},
	enumerateLifecycleObstructingPresence(snapshot) {
		return refundableAuctionCandidates(snapshot).map(candidate => ({ auction: candidate.auction.address, bidIndex: candidate.bid.index, tick: candidate.bid.tick }))
	},
	enumerateLifecyclePresence(snapshot) {
		return snapshot.auctions.flatMap(auction =>
			auction.finalized
				? []
				: auction.bids
						.filter(bid => !bid.refunded)
						.sort(compareAuctionBids)
						.map(bid => ({ auction: auction.address, bidIndex: bid.index, tick: bid.tick })),
		)
	},
	classification: 'lifecycle-obligation',
	contract: 'UniformPriceDualCapBatchAuction',
	description: 'Refunds indexed wallet bids strictly below a live clearing tick before finalization.',
	discoveryInputs: ['canonical auction bid index', 'computeClearing result', 'auction lifecycle'],
	ecosystem: 'statoblast',
	evaluate(snapshot) {
		const found = snapshot.auctions.some(auction => !auction.finalized && auction.hasClearingPrice && auction.bids.some(bid => !bid.refunded && BigInt(bid.tick) < BigInt(auction.clearingTick)))
		return eligible(found ? undefined : 'No indexed wallet bid is currently refundable')
	},
	id: 'statoblast.auction.refund',
	label: 'Refund losing auction bids',
	method: 'refundLosingBids',
	risk: 'low',
}
