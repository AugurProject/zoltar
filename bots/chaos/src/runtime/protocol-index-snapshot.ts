import { encodeAbiParameters, keccak256 } from '@zoltar/bot-shared/ethereum'
import type { ChaosProtocolIndex } from '../monitoring/protocol-index.ts'
import type { EcosystemSnapshot } from '../operations/types.ts'

function verifiedRefundGeneration(auction: EcosystemSnapshot['auctions'][number], index: ChaosProtocolIndex) {
	const pendingAttoEth = BigInt(auction.pendingEthRefund)
	const indexed = index.auctionRefunds[auction.address.toLowerCase()]
	if (pendingAttoEth === 0n) {
		if (indexed !== undefined) throw new Error(`Auction ${auction.address} has an authenticated active refund episode but zero anchored pending storage`)
		return undefined
	}
	if (indexed === undefined) {
		throw new Error(`Auction ${auction.address} has positive pending ETH refund storage without a tracked refund identity`)
	}
	if (BigInt(indexed.pendingAttoEth) !== pendingAttoEth) throw new Error(`Auction ${auction.address} pending ETH refund storage does not match its indexed refund balance`)
	return indexed.generation
}

/** Seed missing refund identities from quorum-verified current storage, not invented historical events. */
export function indexWithCurrentRefunds(snapshot: EcosystemSnapshot, index: ChaosProtocolIndex): ChaosProtocolIndex {
	if (index.cursor.blockNumber !== snapshot.anchor.blockNumber || index.cursor.blockHash.toLowerCase() !== snapshot.anchor.blockHash.toLowerCase()) throw new Error('Refund reconciliation requires the protocol index at the snapshot anchor')
	if (index.chainId !== snapshot.chainId || index.wallet.toLowerCase() !== snapshot.wallet.address.toLowerCase()) throw new Error('Refund reconciliation requires the indexed chain and wallet')
	const auctionRefunds = { ...index.auctionRefunds }
	for (const auction of snapshot.auctions) {
		const key = auction.address.toLowerCase()
		if (auctionRefunds[key] !== undefined || BigInt(auction.pendingEthRefund) === 0n) continue
		const generation = keccak256(encodeAbiParameters([{ type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }], ['chaos:observed-refund:v1', BigInt(snapshot.chainId), snapshot.wallet.address, auction.address, snapshot.anchor.blockHash]))
		auctionRefunds[key] = { generation, pendingAttoEth: auction.pendingEthRefund }
	}
	const reconciled = { ...index, auctionRefunds }
	for (const auction of snapshot.auctions) verifiedRefundGeneration(auction, reconciled)
	return reconciled
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
			const refundGeneration = verifiedRefundGeneration(auction, index)
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
