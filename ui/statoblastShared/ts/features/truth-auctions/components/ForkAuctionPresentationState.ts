import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { TruthAuctionMetrics } from '../../../types/contracts.js'
import { isMigrationClosed } from '../../../protocol/forkMigrationTiming.js'
import { hasTruthAuctionEnded } from '../../../protocol/truthAuctionTiming.js'

export function getStartTruthAuctionGuardMessage({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return forkAuctionCopy.migrationTimingIsUnavailable
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (!isMigrationClosed(currentTimestamp, migrationEndsAt)) return forkAuctionCopy.truthAuctionMigrationPendingDetail
	return undefined
}

/** Why migration actions are closed, from the same `getMigrationEnd` result as the migration badge, so a started truth auction reads as a closed window even before the deadline loads. */
export function getMigrationWindowClosedGuardMessage({ currentTimestamp, migrationEnd }: { currentTimestamp: bigint | undefined; migrationEnd: { ended: boolean } | undefined }) {
	if (migrationEnd?.ended === true) return forkAuctionCopy.parentMigrationExpiredDetail
	if (migrationEnd === undefined) return forkAuctionCopy.migrationTimingIsUnavailable
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
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

/** The migration badge reads from the same `getMigrationEnd` result as the migration end figure, so the two never disagree. */
export function getMigrationStateBadge(migrationEnd: { ended: boolean } | undefined) {
	if (migrationEnd === undefined) return { label: forkAuctionCopy.notStarted, tone: 'muted' } as const
	if (migrationEnd.ended) return { label: forkAuctionCopy.closed, tone: 'ok' } as const
	return { label: forkAuctionCopy.open, tone: 'pending' } as const
}

export function isFullReadClient(client: Pick<ReadClient, 'readContract'> | ReadClient | undefined): client is ReadClient {
	return client !== undefined && 'getBlock' in client && 'multicall' in client
}
