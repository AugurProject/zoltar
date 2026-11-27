import type { SecurityPoolObservation } from '#monitoring/security-pool-monitor'

/** Managed exposure includes direct principal, winning auction lots and reserves for bids that may still win. */
export function totalManagedPrincipalAttoRep(observations: readonly SecurityPoolObservation[]) {
	if (observations.some(observation => observation.pendingOperationReport?.exposureKnown === false)) return undefined
	return observations.reduce((sum, observation) => sum + (observation.managedPrincipalAttoRep ?? observation.snapshot.ownerPrincipalAttoRep), 0n)
}
