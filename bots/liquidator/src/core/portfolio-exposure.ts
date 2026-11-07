import type { PortfolioObservation } from '#monitoring/portfolio-monitor'

/** Managed exposure includes direct principal, owned vaults and pending auction reserves. */
export function totalManagedPrincipalAttoRep(observations: readonly PortfolioObservation[]) {
	return observations.reduce((sum, observation) => sum + (observation.managedPrincipalAttoRep ?? observation.snapshot.ownerPrincipalAttoRep), 0n)
}
