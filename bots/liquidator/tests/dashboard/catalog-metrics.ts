/** Catalog fixtures carry raw collateral units with an explicit token identity. */
export function catalogMetrics(systemState: string, securityPool: string, sharedCommittedRep: string, sharedCommitmentRaw: string) {
	return { systemState, securityPool, sharedCommittedRep, sharedCommitmentRaw, collateralToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }
}
