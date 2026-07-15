const OPEN_ORACLE_BOUNTY_BUFFER_NUMERATOR = 12n
const OPEN_ORACLE_BOUNTY_BUFFER_DENOMINATOR = 10n

export function addOpenOracleBountyBuffer(requiredBounty: bigint) {
	if (requiredBounty <= 0n) return requiredBounty
	return (requiredBounty * OPEN_ORACLE_BOUNTY_BUFFER_NUMERATOR + OPEN_ORACLE_BOUNTY_BUFFER_DENOMINATOR - 1n) / OPEN_ORACLE_BOUNTY_BUFFER_DENOMINATOR
}
