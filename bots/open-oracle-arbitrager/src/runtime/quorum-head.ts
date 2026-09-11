import type { Chain, PublicClient, Transport } from '@zoltar/bot-shared/ethereum'
import { availableSettledValues, quorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import { rpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { endpointLabel } from '#monitoring/connectivity'
import { errorMessage } from '#core/rpc-validation'

type ContextualRpcRead = <Value>(method: string, request: (requestClient: PublicClient<Transport, Chain>) => Promise<Value>, explicitRpcUrl: string) => Promise<Value>

/**
 * Agrees on the lowest head every available reader reports, then requires the configured quorum to
 * return the same block hash for it. The returned block is reused by the scan; it is not read again.
 */
export async function selectQuorumHead<TClient>(readClients: readonly TClient[], endpoints: readonly string[], contextualRpcRead: ContextualRpcRead) {
	const settledHeads = await Promise.allSettled(
		readClients.map(async (_, index) => {
			const rpcUrl = endpoints[index] ?? ''
			return {
				endpoint: endpointLabel(rpcUrl),
				head: await contextualRpcRead('eth_blockNumber', requestClient => requestClient.getBlockNumber(), rpcUrl),
				index,
			}
		}),
	)
	const availableHeads = availableSettledValues(settledHeads)
	const quorumRequirement = rpcQuorumRequirement()
	if (availableHeads.length < quorumRequirement) {
		const failures = settledHeads.flatMap(result => (result.status === 'rejected' ? [errorMessage(result.reason)] : []))
		throw new ConnectivityDegradedError(`Canonical head does not satisfy the configured RPC quorum requirement: ${failures.join('; ')}`)
	}
	const sharedHead = availableHeads.reduce((minimum, observation) => (observation.head < minimum ? observation.head : minimum), availableHeads[0]?.head ?? 0n)
	const settledBlocks = await Promise.allSettled(
		availableHeads.map(async observation => {
			const block = await contextualRpcRead(
				'eth_getBlockByNumber',
				async requestClient => {
					const value = await requestClient.getBlock({ blockNumber: sharedHead })
					if (value.hash == null || value.number == null) throw new Error('Canonical head block is missing its hash or number')
					return { ...value, hash: value.hash, number: value.number }
				},
				endpoints[observation.index] ?? '',
			)
			return { block, endpoint: observation.endpoint, index: observation.index }
		}),
	)
	const availableBlocks = availableSettledValues(settledBlocks)
	if (availableBlocks.length < quorumRequirement) {
		const failures = settledBlocks.flatMap(result => (result.status === 'rejected' ? [errorMessage(result.reason)] : []))
		throw new ConnectivityDegradedError(`Canonical head does not satisfy the configured RPC quorum requirement: ${failures.join('; ')}`)
	}
	quorumValue(
		`canonical head ${sharedHead.toString()}`,
		availableBlocks.map(observation => ({ endpoint: observation.endpoint, value: observation.block.hash })),
		quorumRequirement,
	)
	const selected = availableBlocks[0]
	const selectedClient = selected === undefined ? undefined : readClients[selected.index]
	const selectedRpcUrl = selected === undefined ? undefined : endpoints[selected.index]
	if (selected === undefined || selectedClient === undefined || selectedRpcUrl === undefined) throw new Error('Canonical head does not satisfy the configured RPC quorum requirement')
	return { block: selected.block, client: selectedClient, rpcUrl: selectedRpcUrl }
}
