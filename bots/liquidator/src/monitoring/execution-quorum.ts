import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { availableSettledValues, quorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import type { RpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'

export function availableExecutionObservations<T, V>(label: string, settled: readonly PromiseSettledResult<T>[], observation: (value: T) => { endpoint: string; value: V }, requirement: RpcQuorumRequirement) {
	const available = availableSettledValues(settled, { requirement, endpointOf: value => observation(value).endpoint })
	const observations = available.map(observation)
	if (new Set(observations.map(entry => entry.endpoint)).size < requirement) {
		const failures = settled.flatMap(result => (result.status === 'rejected' ? [errorMessage(result.reason)] : []))
		throw new ConnectivityDegradedError(`${label} requires at least ${requirement === 1 ? 'one available RPC endpoint' : 'two available independent RPC endpoints'}${failures.length === 0 ? '' : `: ${failures.join('; ')}`}`)
	}
	quorumValue(label, observations, requirement)
	return available
}

export function liquidationExecutionSnapshotObservation<TBlock, TUniverse>(observation: { endpoint: string; scan: { block: TBlock; universes: readonly TUniverse[]; securityPools: readonly unknown[]; walletRepByToken: ReadonlyMap<string, bigint> } }) {
	return {
		endpoint: observation.endpoint,
		value: {
			block: observation.scan.block,
			securityPools: observation.scan.securityPools,
			universes: observation.scan.universes,
			walletRepByToken: [...observation.scan.walletRepByToken.entries()].sort(([left], [right]) => left.localeCompare(right)),
		},
	}
}
