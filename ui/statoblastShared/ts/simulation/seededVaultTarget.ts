export function getSeededVaultDepositTargetFactorBps(vault: { vaultRepBackingDepositAttoRep: bigint; underwritingLimitAttoEth: bigint }, minimumBps: bigint) {
	if (vault.underwritingLimitAttoEth <= 0n) throw new Error('Seeded vault underwriting commitments must be positive')
	const numerator = vault.vaultRepBackingDepositAttoRep * minimumBps
	if (numerator % vault.underwritingLimitAttoEth !== 0n) throw new Error('Seeded vault underwriting commitments must map to an exact deposit target factor')
	const depositTargetFactorBps = numerator / vault.underwritingLimitAttoEth
	if (depositTargetFactorBps < minimumBps) throw new Error('Seeded vault target must meet the pool minimum')
	return depositTargetFactorBps
}
