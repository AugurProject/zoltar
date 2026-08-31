import { quorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError, operationalFailureDisposition } from '@zoltar/bot-shared/monitoring/resilience'
import type { RpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'

export function availableExecutionObservations<T, V>(label: string, settled: readonly PromiseSettledResult<T>[], observation: (value: T) => { endpoint: string; value: V }, requirement: RpcQuorumRequirement) {
	const safetyFailure = settled.find(result => result.status === 'rejected' && operationalFailureDisposition(result.reason) === 'safety-paused')
	if (safetyFailure?.status === 'rejected') throw safetyFailure.reason
	const available = settled.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []))
	if (available.length < requirement) {
		const failures = settled.flatMap(result => (result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []))
		throw new ConnectivityDegradedError(`${label} requires at least ${requirement === 1 ? 'one available RPC endpoint' : 'two available independent RPC endpoints'}${failures.length === 0 ? '' : `: ${failures.join('; ')}`}`)
	}
	quorumValue(label, available.map(observation), requirement)
	return available
}

export function liquidationExecutionSnapshotObservation<TBlock, TPool, TUniverse>(observation: { endpoint: string; scan: { block: TBlock; pools: readonly TPool[]; universes: readonly TUniverse[]; walletRepByToken: ReadonlyMap<string, bigint> } }) {
	return {
		endpoint: observation.endpoint,
		value: {
			block: observation.scan.block,
			pools: observation.scan.pools,
			universes: observation.scan.universes,
			walletRepByToken: [...observation.scan.walletRepByToken.entries()].sort(([left], [right]) => left.localeCompare(right)),
		},
	}
}
