import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { TruthAuctionMetrics } from '../../../types/contracts.js'

/** Migration accepts block.timestamp <= forkActivationTime + MIGRATION_TIME, so it closes only after `migrationEndsAt`. */
export function isMigrationClosed(currentTimestamp: bigint, migrationEndsAt: bigint) {
	return currentTimestamp > migrationEndsAt
}

/** UniformPriceDualCapBatchAuction.finalize requires block.timestamp >= auctionStarted + AUCTION_TIME, so the auction has ended at its end time. */
export function hasTruthAuctionEnded(currentTimestamp: bigint, auctionEndsAt: bigint) {
	return currentTimestamp >= auctionEndsAt
}

/** Migration ends at its deadline, or earlier once the outcome's truth auction starts, which ends it at that moment. Undefined while neither time is known. */
export function getMigrationEnd({ auctionStartedAt, currentTimestamp, migrationEndsAt }: { auctionStartedAt: bigint | undefined; currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	const endedByAuction = auctionStartedAt !== undefined && (migrationEndsAt === undefined || auctionStartedAt < migrationEndsAt)
	const endsAt = endedByAuction ? auctionStartedAt : migrationEndsAt
	if (endsAt === undefined) return undefined
	const ended = currentTimestamp !== undefined && (endedByAuction ? endsAt <= currentTimestamp : isMigrationClosed(currentTimestamp, endsAt))
	return { endsAt, ended }
}

export function getStartTruthAuctionGuardMessage({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return forkAuctionCopy.migrationTimingIsUnavailable
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (!isMigrationClosed(currentTimestamp, migrationEndsAt)) return forkAuctionCopy.truthAuctionMigrationPendingDetail
	return undefined
}

export function getMigrationWindowClosedGuardMessage({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return forkAuctionCopy.migrationTimingIsUnavailable
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (isMigrationClosed(currentTimestamp, migrationEndsAt)) return forkAuctionCopy.parentMigrationExpiredDetail
	return undefined
}

export function getTruthAuctionBypassReason({ migratedAttoRep, parentSettlementCollateralAttoEth, auctionableAttoRepAtFork }: { migratedAttoRep: bigint; parentSettlementCollateralAttoEth: bigint | undefined; auctionableAttoRepAtFork: bigint | undefined }) {
	if (parentSettlementCollateralAttoEth === 0n) return forkAuctionCopy.truthAuctionNoCollateralDetail
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
	if (!hasTruthAuctionEnded(currentTimestamp, truthAuctionEndsAt)) return forkAuctionCopy.auctionOngoingReason
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
		if (truthAuction.hitCap && truthAuction.clearingTick !== undefined && truthAuction.clearingPrice !== undefined) return { label: forkAuctionCopy.targetReached, tone: 'pending' } as const
		return { label: forkAuctionCopy.open, tone: 'pending' } as const
	}
	if (truthAuction.underfunded) return { label: forkAuctionCopy.shortfall, tone: 'blocked' } as const
	if (truthAuction.hitCap) return { label: forkAuctionCopy.finalized, tone: 'ok' } as const
	return { label: forkAuctionCopy.unfilled, tone: 'muted' } as const
}

export function getMigrationStateBadge({ currentTimestamp, effectiveTruthAuctionStartedAt, migrationEndsAt }: { currentTimestamp: bigint | undefined; effectiveTruthAuctionStartedAt: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return { label: forkAuctionCopy.notStarted, tone: 'muted' } as const
	if (effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n) return { label: forkAuctionCopy.closed, tone: 'ok' } as const
	if (currentTimestamp !== undefined && isMigrationClosed(currentTimestamp, migrationEndsAt)) return { label: forkAuctionCopy.closed, tone: 'ok' } as const
	return { label: forkAuctionCopy.open, tone: 'pending' } as const
}

export function isFullReadClient(client: Pick<ReadClient, 'readContract'> | ReadClient | undefined): client is ReadClient {
	return client !== undefined && 'getBlock' in client && 'multicall' in client
}
