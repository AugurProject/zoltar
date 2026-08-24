import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js'
import { tryParseTruthAuctionAmountInput } from '@zoltar/ui-core-shared/lib/formInputs.js'
import { estimateRepPurchased } from '../lib/truthAuctionBook.js'
import type { ReadClient, TruthAuctionMetrics } from '@zoltar/ui-core-shared/types/contracts.js'

export function estimateBidRep(bidAmount: string, bidPrice: bigint | undefined) {
	if (bidPrice === undefined) return undefined
	const parsedBidAmount = bidAmount.trim() === '' ? 0n : tryParseTruthAuctionAmountInput(bidAmount)
	if (parsedBidAmount === undefined) return undefined
	return estimateRepPurchased(parsedBidAmount, bidPrice)
}

export function getStartTruthAuctionGuardMessage({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return forkAuctionCopy.migrationTimingIsUnavailable
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (currentTimestamp <= migrationEndsAt) return forkAuctionCopy.truthAuctionMigrationPendingDetail
	return undefined
}

export function getMigrationWindowClosedGuardMessage({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return forkAuctionCopy.migrationTimingIsUnavailable
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (currentTimestamp > migrationEndsAt) return forkAuctionCopy.parentMigrationExpiredDetail
	return undefined
}

export function getTruthAuctionBypassReason({ migratedAttoRep, parentSettlementCollateralAttoEthAmount, auctionableAttoRepAtFork }: { migratedAttoRep: bigint; parentSettlementCollateralAttoEthAmount: bigint | undefined; auctionableAttoRepAtFork: bigint | undefined }) {
	if (parentSettlementCollateralAttoEthAmount === 0n) return forkAuctionCopy.truthAuctionNoCollateralDetail
	if (auctionableAttoRepAtFork === undefined) return undefined
	if (auctionableAttoRepAtFork === 0n) return forkAuctionCopy.truthAuctionNoRepDetail
	if (migratedAttoRep >= auctionableAttoRepAtFork) return forkAuctionCopy.childUniverseFullyMigratedDetail
	return undefined
}

export function getFinalizeTruthAuctionGuardMessage({ currentTimestamp, truthAuction, truthAuctionEndsAt }: { currentTimestamp: bigint | undefined; truthAuction: TruthAuctionMetrics | undefined; truthAuctionEndsAt: bigint | undefined }) {
	if (truthAuction === undefined) return forkAuctionCopy.loadingTruthAuction
	if (truthAuction.finalized) return forkAuctionCopy.truthAuctionFinalizedReason
	if (truthAuctionEndsAt === undefined) return forkAuctionCopy.auctionEndTimeUnavailable
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (currentTimestamp <= truthAuctionEndsAt) return forkAuctionCopy.auctionOngoingReason
	return undefined
}

export function clampPercentage(value: bigint, maxValue: bigint) {
	return (getVisualRatio({ value, maxValue }) ?? 0) * 100
}

export function getTruthAuctionStateBadge({
	hasSelectedAuctionChildPool,
	isStartTruthAuctionInProgress,
	startTruthAuctionCountdown,
	truthAuction,
	truthAuctionStartedAt,
}: {
	hasSelectedAuctionChildPool: boolean
	isStartTruthAuctionInProgress: boolean
	startTruthAuctionCountdown: bigint | undefined
	truthAuction: TruthAuctionMetrics | undefined
	truthAuctionStartedAt: bigint
}) {
	if (truthAuction === undefined) {
		if (isStartTruthAuctionInProgress || (hasSelectedAuctionChildPool && truthAuctionStartedAt === 0n && startTruthAuctionCountdown !== undefined && startTruthAuctionCountdown > 0n)) return { label: commonCopy.pending, tone: 'pending' } as const
		if (truthAuctionStartedAt > 0n) return { label: forkAuctionCopy.started, tone: 'pending' } as const
		return { label: forkAuctionCopy.inactive, tone: 'muted' } as const
	}
	if (!truthAuction.finalized) {
		if (truthAuction.hitCap && truthAuction.clearingTick !== undefined && truthAuction.clearingPrice !== undefined) return { label: forkAuctionCopy.clearing, tone: 'pending' } as const
		return { label: forkAuctionCopy.open, tone: 'pending' } as const
	}
	if (truthAuction.underfunded) return { label: forkAuctionCopy.shortfall, tone: 'blocked' } as const
	if (truthAuction.hitCap) return { label: commonCopy.settled, tone: 'ok' } as const
	return { label: forkAuctionCopy.unfilled, tone: 'muted' } as const
}

export function getMigrationStateBadge({ currentTimestamp, effectiveTruthAuctionStartedAt, migrationEndsAt }: { currentTimestamp: bigint | undefined; effectiveTruthAuctionStartedAt: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return { label: forkAuctionCopy.notStartedBadgeLabel, tone: 'muted' } as const
	if (effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n) return { label: forkAuctionCopy.closed, tone: 'ok' } as const
	if (currentTimestamp !== undefined && currentTimestamp >= migrationEndsAt) return { label: forkAuctionCopy.closed, tone: 'ok' } as const
	return { label: forkAuctionCopy.open, tone: 'pending' } as const
}

export function isFullReadClient(client: Pick<ReadClient, 'readContract'> | ReadClient | undefined): client is ReadClient {
	return client !== undefined && 'getBlock' in client && 'multicall' in client
}
