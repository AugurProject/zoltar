const OPEN_ORACLE_BOUNTY_BUFFER_NUMERATOR = 12n;
const OPEN_ORACLE_BOUNTY_BUFFER_DENOMINATOR = 10n;
const OPEN_ORACLE_INITIAL_REPORT_FUNDING_BUFFER = 2n;
export function addOpenOracleBountyBuffer(requiredBountyAttoEth) {
    if (requiredBountyAttoEth <= 0n)
        return requiredBountyAttoEth;
    return (requiredBountyAttoEth * OPEN_ORACLE_BOUNTY_BUFFER_NUMERATOR + OPEN_ORACLE_BOUNTY_BUFFER_DENOMINATOR - 1n) / OPEN_ORACLE_BOUNTY_BUFFER_DENOMINATOR;
}
export function addOpenOracleInitialReportFundingBuffer(requiredAmount) {
    if (requiredAmount < 0n)
        throw new RangeError('Required initial report funding cannot be negative');
    return requiredAmount * OPEN_ORACLE_INITIAL_REPORT_FUNDING_BUFFER;
}
export function getOpenOracleDisputeSwapTokenKey({ currentAmount1, currentAmount2, newAmount1, newAmount2 }) {
    return newAmount2 * currentAmount1 > currentAmount2 * newAmount1 ? 'token2' : 'token1';
}
//# sourceMappingURL=openOracleMath.js.map