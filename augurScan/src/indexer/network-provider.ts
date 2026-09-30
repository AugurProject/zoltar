import { type Address, zeroAddress } from '../ethereum.ts'
import { findEarliestAvailableStateBlock, isPrunedHistoricalStateError } from '../indexer-runtime.ts'
import { findManifestContractDeployment, type IndexerRpcProvider, type RpcBlockHeader, requireRpcBlockHeader } from './planning.ts'
import type { NetworkIndexerState, ProviderState } from './network-state.ts'

/** Network, provider, and state-boundary records needed to read and rediscover historical state. */
export type HistoricalStateContext = Pick<NetworkIndexerState, 'network' | 'providers' | 'stateBoundary'>

export type BlockHeaderReader = (providers: ProviderState, blockNumber: bigint) => Promise<RpcBlockHeader>

export const getBlockHeader: BlockHeaderReader = async (providers, blockNumber) => requireRpcBlockHeader(await providers.client.getBlock({ blockNumber, includeTransactions: true }), blockNumber)

export function rpcFailureReason(providers: ProviderState, error: unknown): string {
	return providers.diagnostics.failureReason(error)
}

export function historicalCodeUnavailable(providers: ProviderState): Set<string> {
	const stored = providers.historicalCodeUnavailable.get(providers.active)
	if (stored !== undefined) return stored
	const created = new Set<string>()
	providers.historicalCodeUnavailable.set(providers.active, created)
	return created
}

export function selectProvider(state: HistoricalStateContext, provider: IndexerRpcProvider): void {
	state.providers.active = provider
	state.providers.client = provider.client
	state.providers.logClient = provider.logClient
	state.providers.diagnostics.select(provider)
	const boundary = state.providers.stateBoundaries.get(provider)
	state.stateBoundary.startBlock = boundary?.startBlock ?? state.network.startBlock
	state.stateBoundary.discovered = boundary?.discovered ?? false
}

export function rememberHistoricalCodeUnavailable(state: Pick<NetworkIndexerState, 'network' | 'providers'>, address: Address, error: unknown): void {
	const key = address.toLowerCase()
	const unavailable = historicalCodeUnavailable(state.providers)
	if (unavailable.has(key)) return
	unavailable.add(key)
	console.warn(`[${state.network.id}] historical contract code unavailable for ${address}; scanning complete available coverage from block #${state.network.startBlock} instead: ${rpcFailureReason(state.providers, error)}`)
}

export async function findManifestDeployment(state: HistoricalStateContext, address: Address, startBlock: bigint, indexedBoundary: bigint, startBlockKnownAbsent: boolean): Promise<{ readonly block: bigint; readonly exact: boolean } | undefined> {
	if (historicalCodeUnavailable(state.providers).has(address.toLowerCase())) return { block: startBlock, exact: false }
	for (let attempt = 0; attempt < 2; attempt++) {
		const searchStart = state.stateBoundary.startBlock > startBlock ? state.stateBoundary.startBlock : startBlock
		try {
			return await findManifestContractDeployment(
				address,
				searchStart,
				indexedBoundary,
				startBlockKnownAbsent && searchStart === startBlock,
				(candidate, blockNumber) => state.providers.client.getBytecode({ address: candidate, blockNumber }),
				5_000,
				Date.now,
				error => rememberHistoricalCodeUnavailable(state, address, error),
			)
		} catch (error) {
			if (!isPrunedHistoricalStateError(error) || attempt > 0) throw error
			await discoverStateStartBlock(state, await state.providers.client.getBlockNumber(), state.stateBoundary.startBlock, true)
		}
	}
	throw new Error('Manifest deployment state boundary retry was exhausted')
}

export async function discoverStateStartBlock(state: HistoricalStateContext, observedHead: bigint, searchStart = state.network.startBlock, searchStartKnownUnavailable = false): Promise<void> {
	if (searchStart > observedHead) {
		state.stateBoundary.startBlock = searchStart
		return
	}
	const stateStartBlock = await findEarliestAvailableStateBlock(
		searchStart,
		observedHead,
		async blockNumber => {
			await state.providers.client.getBalance({ address: zeroAddress, blockNumber })
		},
		searchStartKnownUnavailable,
	)
	state.stateBoundary.startBlock = stateStartBlock
	state.stateBoundary.discovered = true
	state.providers.stateBoundaries.set(state.providers.active, { startBlock: stateStartBlock, discovered: true })
	if (stateStartBlock > state.network.startBlock) console.warn(`[${state.network.id}] RPC historical state before block #${stateStartBlock} is pruned; state-dependent reads will begin at the earliest retrievable state block while log indexing independently begins at its earliest retrievable log block`)
}
