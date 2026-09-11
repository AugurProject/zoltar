import { type Address } from '@zoltar/bot-shared/ethereum'

const FORK_MIGRATION_WINDOW_SECONDS = 8n * 7n * 24n * 60n * 60n

export function forkMigrationWindowIsOpen(systemState: bigint, forkActivationTime: bigint, timestamp: bigint) {
	return systemState === 1n && forkActivationTime > 0n && timestamp <= forkActivationTime + FORK_MIGRATION_WINDOW_SECONDS
}

export function forkRepMigrationTarget(forkData: { auctionableAttoRepAtFork: bigint; ownFork: boolean }, status: { auctionableAttoRepAtFork: bigint; ownFork: boolean; vaultRepAtForkAttoRep: bigint }, pool: Address) {
	if (status.ownFork !== forkData.ownFork || status.auctionableAttoRepAtFork !== forkData.auctionableAttoRepAtFork) {
		throw new Error(`Pool ${pool} returned inconsistent fork migration buckets`)
	}
	return status.ownFork ? status.vaultRepAtForkAttoRep : status.auctionableAttoRepAtFork
}
