import type { EcosystemSnapshot, ImmutableTopologyPlanningCapacity, PlanningOptions } from './types.ts'

export const INVALID_IMMUTABLE_TOPOLOGY_CAPACITY_BLOCKER = 'Immutable topology discovery capacity is unavailable or invalid'

export function aggregateProductFits(left: number, right: number, maximum: number) {
	return Number.isSafeInteger(left) && left >= 0 && Number.isSafeInteger(right) && right >= 0 && Number.isSafeInteger(maximum) && maximum > 0 && (left === 0 || right <= Math.floor(maximum / left))
}

/**
 * Revalidates the planning envelope at its point of use so novel topology
 * mutations fail closed even when a non-config caller constructs options.
 */
export function configuredImmutableTopologyCapacity(options: PlanningOptions): ImmutableTopologyPlanningCapacity | undefined {
	const capacity = options.immutableTopologyCapacity
	if (capacity === undefined) return undefined
	const limits = [capacity.maxPools, capacity.maxQuestions, capacity.maxStagedOperationsPerPool, capacity.maxUniverses, capacity.maxVaultsPerPool, capacity.maximumAggregateItems]
	if (limits.some(limit => !Number.isSafeInteger(limit) || limit <= 0)) return undefined
	if ([capacity.maxPools, capacity.maxQuestions, capacity.maxStagedOperationsPerPool, capacity.maxUniverses, capacity.maxVaultsPerPool].some(limit => limit > capacity.maximumAggregateItems)) return undefined
	if (!aggregateProductFits(capacity.maxPools, capacity.maxUniverses, capacity.maximumAggregateItems)) return undefined
	if (!aggregateProductFits(capacity.maxPools, capacity.maxVaultsPerPool, capacity.maximumAggregateItems)) return undefined
	if (!aggregateProductFits(capacity.maxPools, capacity.maxStagedOperationsPerPool, capacity.maximumAggregateItems)) return undefined
	return capacity
}

export interface ImmutableTopologyMutation {
	additionalPools: number
	additionalUniverses: number
	label: string
}

/**
 * Checks the final discovered shape of a mutation that may create more than
 * one topology object atomically. A no-op remains usable at an exact limit and
 * does not require capacity configuration because it cannot grow discovery.
 */
export function topologyMutationCapacityBlocker(snapshot: EcosystemSnapshot, options: PlanningOptions, mutation: ImmutableTopologyMutation) {
	if (mutation.additionalPools === 0 && mutation.additionalUniverses === 0) return undefined
	if (![mutation.additionalPools, mutation.additionalUniverses].every(value => Number.isSafeInteger(value) && value >= 0)) return INVALID_IMMUTABLE_TOPOLOGY_CAPACITY_BLOCKER
	const capacity = configuredImmutableTopologyCapacity(options)
	if (capacity === undefined) return INVALID_IMMUTABLE_TOPOLOGY_CAPACITY_BLOCKER
	const resultingPools = snapshot.pools.length + mutation.additionalPools
	const resultingUniverses = snapshot.universes.length + mutation.additionalUniverses
	if (!Number.isSafeInteger(resultingPools) || resultingPools > capacity.maxPools) {
		return `${mutation.label} would exceed the configured ${capacity.maxPools.toString()}-pool discovery resident limit`
	}
	if (!Number.isSafeInteger(resultingUniverses) || resultingUniverses > capacity.maxUniverses) {
		return `${mutation.label} would exceed the configured ${capacity.maxUniverses.toString()}-universe discovery resident limit`
	}
	for (const [aggregateLabel, left, right] of [
		['pool × universe', resultingPools, resultingUniverses],
		['pool × vault', resultingPools, capacity.maxVaultsPerPool],
		['pool × staged-operation', resultingPools, capacity.maxStagedOperationsPerPool],
	] as const) {
		if (!aggregateProductFits(left, right, capacity.maximumAggregateItems)) {
			return `${mutation.label} would exceed the configured ${capacity.maximumAggregateItems.toString()}-item ${aggregateLabel} discovery aggregate limit`
		}
	}
	return undefined
}

export interface VaultRegistrationCapacity {
	canonicalVaultCount: string
	registered: boolean
}

/** Existing vault routes remain executable at the exact resident limit. */
export function vaultRegistrationCapacityBlocker(registration: VaultRegistrationCapacity, options: PlanningOptions, label = 'Vault registration') {
	if (registration.registered) return undefined
	const capacity = configuredImmutableTopologyCapacity(options)
	if (capacity === undefined) return INVALID_IMMUTABLE_TOPOLOGY_CAPACITY_BLOCKER
	if (!/^(?:0|[1-9][0-9]*)$/.test(registration.canonicalVaultCount)) return INVALID_IMMUTABLE_TOPOLOGY_CAPACITY_BLOCKER
	if (BigInt(registration.canonicalVaultCount) + 1n > BigInt(capacity.maxVaultsPerPool)) {
		return `${label} would exceed the configured ${capacity.maxVaultsPerPool.toString()}-vault per-pool discovery resident limit`
	}
	return undefined
}
