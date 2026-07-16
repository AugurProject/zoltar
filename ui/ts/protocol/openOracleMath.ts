const OPEN_ORACLE_BOUNTY_BUFFER_NUMERATOR = 12n
const OPEN_ORACLE_BOUNTY_BUFFER_DENOMINATOR = 10n
const OPEN_ORACLE_INITIAL_REPORT_FUNDING_BUFFER = 2n

export function addOpenOracleBountyBuffer(requiredBounty: bigint) {
	if (requiredBounty <= 0n) return requiredBounty
	return (requiredBounty * OPEN_ORACLE_BOUNTY_BUFFER_NUMERATOR + OPEN_ORACLE_BOUNTY_BUFFER_DENOMINATOR - 1n) / OPEN_ORACLE_BOUNTY_BUFFER_DENOMINATOR
}

export function addOpenOracleInitialReportFundingBuffer(requiredAmount: bigint) {
	if (requiredAmount < 0n) throw new RangeError('Required initial report funding cannot be negative')
	return requiredAmount * OPEN_ORACLE_INITIAL_REPORT_FUNDING_BUFFER
}
