import type { ChaosProtocolIndex } from '../monitoring/protocol-index.ts'
import type { EcosystemSnapshot } from '../operations/types.ts'

export function snapshotWithProtocolIndex(snapshot: EcosystemSnapshot, index: ChaosProtocolIndex): EcosystemSnapshot {
	const migrationRepSplitsByUniverse = new Map<string, Record<string, string>>()
	for (const progress of index.migrationRepSplits) {
		const routes = migrationRepSplitsByUniverse.get(progress.universeId) ?? {}
		routes[progress.outcomeIndex] = progress.childMigrationRepAmountAttoRep
		migrationRepSplitsByUniverse.set(progress.universeId, routes)
	}
	return {
		...snapshot,
		auctions: snapshot.auctions.map(auction => ({ ...auction, bids: [...(index.auctionBids[auction.engine.toLowerCase()] ?? [])] })),
		escalationDeposits: index.escalationDeposits.map(deposit => ({ ...deposit })),
		reports: index.reports.map(report => ({
			...report,
			game: { ...report.game },
			helper: { ...report.helper },
		})),
		universes: snapshot.universes.map(universe => ({
			...universe,
			migrationRepSplitProgressByOutcome: { ...(migrationRepSplitsByUniverse.get(universe.id) ?? {}) },
		})),
	}
}
