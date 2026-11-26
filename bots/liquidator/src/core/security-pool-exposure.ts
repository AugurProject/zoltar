import type { SecurityPoolObservation } from '#monitoring/security-pool-monitor'

/** Managed exposure includes direct principal, owned vaults and pending auction reserves. */
export function totalManagedPrincipalAttoRep(observations: readonly SecurityPoolObservation[]) {
	if (observations.some(observation => observation.pendingOperationReport?.exposureKnown === false)) return undefined
	return observations.reduce((sum, observation) => sum + (observation.managedPrincipalAttoRep ?? observation.snapshot.ownerPrincipalAttoRep), 0n)
}
