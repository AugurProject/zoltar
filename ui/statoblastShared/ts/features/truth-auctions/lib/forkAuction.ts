import type { ForkOutcomeKey, SecurityPoolSystemState } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ForkAuctionDetails, SecurityPoolVaultSummary, TruthAuctionMetrics } from '../../../types/contracts.js'
import { getTimeRemaining as getSharedTimeRemaining } from '@zoltar/ui-core-shared/lib/time.js'
import { deriveHasForkActivity } from '../../../protocol/forkActivity.js'
import { isMigrationClosed } from '../../../protocol/forkMigrationTiming.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'

/**
 * When migration ends and whether it has. `SecurityPoolForker.startTruthAuction` requires block.timestamp >
 * forkActivationTime + MIGRATION_TIME, so once the selected outcome's truth auction has started, migration had ended by
 * then, even before the chain time loads; the auction start stands in when the loaded deadline is unknown or reads later.
 * Undefined while neither time is known.
 */
export function getMigrationEnd({ auctionStartedAt, currentTimestamp, migrationEndsAt }: { auctionStartedAt: bigint | undefined; currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	const endedByAuction = auctionStartedAt !== undefined && (migrationEndsAt === undefined || auctionStartedAt < migrationEndsAt)
	const endsAt = endedByAuction ? auctionStartedAt : migrationEndsAt
	if (endsAt === undefined) return undefined
	const ended = auctionStartedAt !== undefined || (currentTimestamp !== undefined && isMigrationClosed(currentTimestamp, endsAt))
	return { endsAt, ended }
}

export { deriveHasForkActivity }

export const AUCTIONED_UNDERWRITING_LIMIT_ATTO_ETH_LABEL = 'Auctioned underwriting commitments'

export type ForkAuctionStageView = 'initiate' | 'migration' | 'auction' | 'settlement'

const FORK_AUCTION_STAGE_LABELS: Record<ForkAuctionStageView, string> = {
	initiate: forkAuctionCopy.forkTrigger,
	migration: forkAuctionCopy.migration,
	auction: commonCopy.truthAuction,
	settlement: commonCopy.settlement,
}

type ForkAuctionStageSource = {
	claimingAvailable?: boolean
	forkOutcome: ForkOutcomeKey
	migratedAttoRep: bigint
	systemState: SecurityPoolSystemState
	truthAuction?: Pick<TruthAuctionMetrics, 'finalized'> | undefined
	truthAuctionStartedAt: bigint
}

export function getForkAuctionStageLabel(stage: ForkAuctionStageView) {
	return FORK_AUCTION_STAGE_LABELS[stage]
}

export function getForkAuctionStageView(source: ForkAuctionStageSource): ForkAuctionStageView {
	if (source.truthAuction !== undefined) {
		if (!source.truthAuction.finalized) return 'auction'
		return 'settlement'
	}

	if (source.systemState === 'forkTruthAuction') return 'auction'
	if (source.claimingAvailable === true) return 'settlement'
	if (source.systemState === 'operational' && deriveHasForkActivity(source)) return 'settlement'
	if (source.systemState === 'poolForked' || source.systemState === 'forkMigration' || source.migratedAttoRep > 0n) return 'migration'
	return 'initiate'
}

export function getTimeRemaining(targetTime: bigint | undefined, currentTime: bigint) {
	return getSharedTimeRemaining(targetTime, currentTime)
}

/** The pool-held REP snapshot that fork migration splits across child universes, mirroring SecurityPoolForker: an own fork splits the vault REP snapshot, otherwise the auctionable REP. */
export function getForkPoolHeldRepAtForkAttoRep(details: Pick<ForkAuctionDetails, 'auctionableAttoRepAtFork' | 'ownForkRepBuckets'>) {
	return details.ownForkRepBuckets?.vaultRepAtForkAttoRep ?? details.auctionableAttoRepAtFork
}

/**
 * The pool-held REP `migrateVault` moves for a parent vault. Once the pool forks, its REP leaves the pool, so the vault's current REP backing reads zero;
 * migration instead credits the vault's backing-unit share of the REP snapshotted at fork (SecurityPoolForkerVaultMigrationBase). The last vault to
 * migrate also receives the rounding remainder, so this floor can be a few attoREP low. Undefined when the inputs aren't loaded.
 */
export function getForkVaultMigrationRepAttoRep(details: Pick<ForkAuctionDetails, 'auctionableAttoRepAtFork' | 'ownForkRepBuckets' | 'systemState'> | undefined, vault: Pick<SecurityPoolVaultSummary, 'repBackingUnits' | 'totalRepBackingUnits' | 'vaultAttoRepBacking'> | undefined) {
	if (details === undefined || vault === undefined) return undefined
	if (details.systemState !== 'poolForked') return vault.vaultAttoRepBacking
	const { repBackingUnits, totalRepBackingUnits } = vault
	if (repBackingUnits === undefined || totalRepBackingUnits === undefined) return undefined
	if (repBackingUnits === 0n || totalRepBackingUnits === 0n) return 0n
	return (repBackingUnits * getForkPoolHeldRepAtForkAttoRep(details)) / totalRepBackingUnits
}
