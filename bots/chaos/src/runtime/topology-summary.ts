import type { Address } from '@zoltar/bot-shared/ethereum'
import type { CanonicalImmutableTopologyCache } from '../monitoring/topology-cache.ts'
import type { RuntimeTopologySummary } from '../state/operator-state.ts'
import type { CanonicalScanResult } from './canonical-scan.ts'

export function runtimeTopologySummary(scan: Pick<CanonicalScanResult, 'anchor' | 'executionReady' | 'snapshot' | 'topologyCache'>): RuntimeTopologySummary {
	return {
		anchor: { blockNumber: scan.anchor.blockNumber, timestamp: scan.anchor.timestamp },
		auctions: scan.snapshot.auctions.map(auction => ({
			address: auction.address,
			bidCount: auction.bids.length,
			endTime: auction.endTime,
			finalized: auction.finalized,
			pool: auction.pool,
			startTime: auction.startTime,
		})),
		complete: scan.executionReady,
		pairs: scan.snapshot.pairs.map(pair => ({ address: pair.address, feeBps: pair.feeBps, pool: pair.pool, status: pair.status, universeId: pair.universeId })),
		pools: scan.snapshot.pools.map(pool => ({
			address: pool.address,
			awaitingForkContinuation: pool.awaitingForkContinuation,
			coordinator: pool.coordinator,
			questionId: pool.questionId,
			systemState: pool.systemState,
			universeId: pool.universeId,
			vaultCount: registeredVaultCount(scan.topologyCache, pool.address),
		})),
		reports: scan.snapshot.reports.map(report => ({
			currentReporter: report.currentReporter,
			flags: report.flags,
			reportId: report.reportId,
			settlementTime: report.settlementTime,
			token1: report.token1,
			token2: report.token2,
		})),
		universes: scan.snapshot.universes.map(universe => ({
			forkQuestionId: universe.forkQuestionId,
			forkTime: universe.forkTime,
			id: universe.id,
			knownChildOutcomeCount: universe.knownChildOutcomes.length,
			...(universe.parentUniverseId === undefined ? {} : { parentUniverseId: universe.parentUniverseId }),
			repToken: universe.repToken,
		})),
	}
}

function registeredVaultCount(topologyCache: CanonicalImmutableTopologyCache, pool: Address) {
	const cursor = topologyCache.discoveryCursors.vaultsByPool[pool.toLowerCase()]
	if (cursor === undefined) throw new Error(`Canonical topology cache omitted the vault registry cursor for pool ${pool}`)
	const count = BigInt(cursor.canonicalCount)
	if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Canonical vault count for pool ${pool} exceeds the dashboard safe integer range`)
	return Number(count)
}
