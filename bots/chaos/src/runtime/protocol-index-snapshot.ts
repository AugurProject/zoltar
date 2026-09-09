import type { ChaosProtocolIndex } from '../monitoring/protocol-index.ts'
import type { EcosystemSnapshot } from '../operations/types.ts'

function authenticatedRefundGenerationAtCompleteIndex(auction: EcosystemSnapshot['auctions'][number], index: ChaosProtocolIndex) {
	if (index.availableStartBlock !== undefined) return undefined
	const pendingAttoEth = BigInt(auction.pendingEthRefund)
	const indexed = index.auctionRefunds[auction.address.toLowerCase()]
	if (pendingAttoEth === 0n) {
		if (indexed !== undefined) throw new Error(`Auction ${auction.address} has an authenticated active refund episode but zero anchored pending storage`)
		return undefined
	}
	if (indexed === undefined) {
		throw new Error(`Auction ${auction.address} has positive pending ETH refund storage without an authenticated EthRefundCredited episode; protocolStartBlock may be after the episode start or the indexed history is incomplete`)
	}
	if (BigInt(indexed.pendingAttoEth) !== pendingAttoEth) throw new Error(`Auction ${auction.address} pending ETH refund storage does not match its authenticated event episode`)
	return indexed.generation
}

export function snapshotWithProtocolIndex(snapshot: EcosystemSnapshot, index: ChaosProtocolIndex): EcosystemSnapshot {
	const childRepSplitsByPool = new Map<string, Record<string, string>>()
	for (const progress of index.childRepSplits) {
		const key = progress.pool.toLowerCase()
		const routes = childRepSplitsByPool.get(key) ?? {}
		routes[progress.outcomeIndex] = progress.childPoolRepSplitAttoRep
		childRepSplitsByPool.set(key, routes)
	}
	const migrationRepSplitsByUniverse = new Map<string, Record<string, string>>()
	for (const progress of index.migrationRepSplits) {
		const routes = migrationRepSplitsByUniverse.get(progress.universeId) ?? {}
		routes[progress.outcomeIndex] = progress.childMigrationRepAmountAttoRep
		migrationRepSplitsByUniverse.set(progress.universeId, routes)
	}
	return {
		...snapshot,
		auctions: snapshot.auctions.map(auction => {
			const refundGeneration = authenticatedRefundGenerationAtCompleteIndex(auction, index)
			const { pendingEthRefundGeneration: _partialGeneration, ...topologyAuction } = auction
			return {
				...topologyAuction,
				bids: [...(index.auctionBids[auction.address.toLowerCase()] ?? [])],
				...(refundGeneration === undefined ? {} : { pendingEthRefundGeneration: refundGeneration }),
			}
		}),
		escalationDeposits: index.escalationDeposits.map(deposit => ({ ...deposit })),
		pools: snapshot.pools.map(pool => ({
			...pool,
			forkRepMigrationProgressByOutcome: { ...(childRepSplitsByPool.get(pool.address.toLowerCase()) ?? {}) },
		})),
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
