import { type Address, zeroAddress } from '../ethereum.ts'
import { findEarliestAvailableStateBlock, isPrunedHistoricalStateError } from '../indexer-runtime.ts'
import { findManifestContractDeployment, type IndexerRpcProvider, type RpcBlockHeader, requireRpcBlockHeader } from './planning.ts'
import type { NetworkIndexer } from './block-ingestion.ts'

export async function getBlockHeader(this: NetworkIndexer, blockNumber: bigint): Promise<RpcBlockHeader> {
	return requireRpcBlockHeader(await this.client.getBlock({ blockNumber }), blockNumber)
}

export function historicalCodeUnavailable(this: NetworkIndexer): Set<string> {
	const stored = this.providerHistoricalCodeUnavailable.get(this.activeProvider)
	if (stored !== undefined) return stored
	const created = new Set<string>()
	this.providerHistoricalCodeUnavailable.set(this.activeProvider, created)
	return created
}

export function selectProvider(this: NetworkIndexer, provider: IndexerRpcProvider): void {
	this.activeProvider = provider
	this.client = provider.client
	this.logClient = provider.logClient
	this.rpcDiagnostics.select(provider)
	const boundary = this.providerStateBoundaries.get(provider)
	this.stateStartBlock = boundary?.startBlock ?? this.network.startBlock
	this.stateBoundaryDiscovered = boundary?.discovered ?? false
}

export function rememberHistoricalCodeUnavailable(this: NetworkIndexer, address: Address, error: unknown): void {
	const key = address.toLowerCase()
	const unavailable = this.historicalCodeUnavailable()
	if (unavailable.has(key)) return
	unavailable.add(key)
	console.warn(`[${this.network.id}] historical contract code unavailable for ${address}; scanning complete available coverage from block #${this.network.startBlock} instead: ${this.rpcFailureReason(error)}`)
}

export async function findManifestDeployment(this: NetworkIndexer, address: Address, startBlock: bigint, indexedBoundary: bigint, startBlockKnownAbsent: boolean): Promise<{ readonly block: bigint; readonly exact: boolean } | undefined> {
	if (this.historicalCodeUnavailable().has(address.toLowerCase())) return { block: startBlock, exact: false }
	for (let attempt = 0; attempt < 2; attempt++) {
		const searchStart = this.stateStartBlock > startBlock ? this.stateStartBlock : startBlock
		try {
			return await findManifestContractDeployment(
				address,
				searchStart,
				indexedBoundary,
				startBlockKnownAbsent && searchStart === startBlock,
				(candidate, blockNumber) => this.client.getBytecode({ address: candidate, blockNumber }),
				5_000,
				Date.now,
				error => this.rememberHistoricalCodeUnavailable(address, error),
			)
		} catch (error) {
			if (!isPrunedHistoricalStateError(error) || attempt > 0) throw error
			await this.discoverStateStartBlock(await this.client.getBlockNumber(), this.stateStartBlock, true)
		}
	}
	throw new Error('Manifest deployment state boundary retry was exhausted')
}

export async function discoverStateStartBlock(this: NetworkIndexer, observedHead: bigint, searchStart = this.network.startBlock, searchStartKnownUnavailable = false): Promise<void> {
	if (searchStart > observedHead) {
		this.stateStartBlock = searchStart
		return
	}
	const stateStartBlock = await findEarliestAvailableStateBlock(
		searchStart,
		observedHead,
		async blockNumber => {
			await this.client.getBalance({ address: zeroAddress, blockNumber })
		},
		searchStartKnownUnavailable,
	)
	this.stateStartBlock = stateStartBlock
	this.stateBoundaryDiscovered = true
	this.providerStateBoundaries.set(this.activeProvider, { startBlock: stateStartBlock, discovered: true })
	if (stateStartBlock > this.network.startBlock) console.warn(`[${this.network.id}] RPC historical state before block #${stateStartBlock} is pruned; state-dependent reads will begin at the earliest retrievable state block while log indexing independently begins at its earliest retrievable log block`)
}
