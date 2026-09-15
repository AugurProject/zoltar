export function getSeededVaultDepositTargetFactorBps(vault: { vaultRepBackingDepositAttoRep: bigint; capacityOwnershipAttoRep: bigint }, minimumBps: bigint) {
	if (vault.capacityOwnershipAttoRep <= 0n) throw new Error('Seeded vault capacity ownership must be positive')
	const numerator = vault.vaultRepBackingDepositAttoRep * minimumBps
	if (numerator % vault.capacityOwnershipAttoRep !== 0n) throw new Error('Seeded vault capacity ownership must map to an exact deposit target factor')
	const depositTargetFactorBps = numerator / vault.capacityOwnershipAttoRep
	if (depositTargetFactorBps < minimumBps) throw new Error('Seeded vault target must meet the pool minimum')
	return depositTargetFactorBps
}
