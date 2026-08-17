const DEFAULT_OPEN_ORACLE_DISPUTE_DELAY_SECONDS = '3600';
const DEFAULT_OPEN_ORACLE_SETTLEMENT_DELAY_SECONDS = '86400';
export function getDefaultOpenOracleFormState() {
    return {
        amount1: '0',
        amount2: '0',
        disputeNewAmount1: '0',
        disputeNewAmount2: '0',
        disputeTokenToSwap: 'token1',
        reportId: '',
        stateHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    };
}
export function getDefaultOpenOracleCreateFormState() {
    return {
        disputeDelay: DEFAULT_OPEN_ORACLE_DISPUTE_DELAY_SECONDS,
        escalationHalt: '0',
        exactToken1Report: '0',
        initialToken2Amount: '0',
        ethValue: '0',
        feePercentage: '0',
        multiplier: '100',
        protocolFee: '0',
        settlementTime: DEFAULT_OPEN_ORACLE_SETTLEMENT_DELAY_SECONDS,
        settlerRewardEthAmount: '0',
        token1Address: '',
        token2Address: '',
    };
}
export function getDefaultReportingWithdrawDepositIndexesByOutcome() {
    return {
        invalid: [],
        yes: [],
        no: [],
    };
}
export function getDefaultReportingFormState() {
    return {
        reportAmount: '0',
        securityPoolAddress: '',
        selectedOutcome: undefined,
        selectedWithdrawDepositIndexesByOutcome: getDefaultReportingWithdrawDepositIndexesByOutcome(),
    };
}
export function getDefaultZoltarMigrationFormState() {
    return {
        amount: '0.0',
        outcomeIndexes: '',
    };
}
//# sourceMappingURL=formDefaults.js.map