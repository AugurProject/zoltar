import type { ForkOutcomeKey, SecurityPoolSystemState } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ForkAuctionDetails, SecurityPoolVaultSummary, TruthAuctionMetrics } from '../../../types/contracts.js'
import { getTimeRemaining as getSharedTimeRemaining } from '@zoltar/ui-core-shared/lib/time.js'
import { deriveHasForkActivity } from '../../../protocol/forkActivity.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'

export { deriveHasForkActivity }

const SECONDS_PER_WEEK = 7n * 24n * 60n * 60n

export const AUCTION_TIME_SECONDS = SECONDS_PER_WEEK
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
