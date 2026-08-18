import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/shared/oracleInitialReport';
import { parseDecimalInput, tryParseDecimalInput } from '@zoltar/ui-core-shared/lib/decimal.js';
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js';
const STATOBLAST_SECURITY_MULTIPLIER_DECIMALS = 4;
export function getDefaultMarketFormState() {
    return {
        answerUnit: '',
        categoricalOutcomes: ['Yes', 'No'],
        description: '',
        endTime: '',
        marketType: 'binary',
        scalarIncrement: '1',
        scalarMax: '100',
        scalarMin: '0',
        title: '',
        startTime: '',
    };
}
export function getDefaultSecurityPoolFormState() {
    return {
        initialReportPriorityFeeGwei: formatCurrencyInputBalance(DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, 9),
        marketId: '',
        statoblastSecurityMultiplierBps: '2',
    };
}
export function parseStatoblastSecurityMultiplierBpsInput(value) {
    return parseDecimalInput(value, 'Statoblast security multiplier', STATOBLAST_SECURITY_MULTIPLIER_DECIMALS);
}
export function tryParseStatoblastSecurityMultiplierBpsInput(value) {
    return tryParseDecimalInput(value, STATOBLAST_SECURITY_MULTIPLIER_DECIMALS);
}
export function getDefaultSecurityVaultFormState() {
    return {
        depositAmount: '0',
        targetHealthFactor: '2',
        repWithdrawAmount: '0',
        selectedVaultOwner: '',
        securityPoolAddress: '',
        stagedOperationTimeoutMinutes: '5',
    };
}
export function getDefaultTradingFormState() {
    return {
        completeSetAmount: '0',
        redeemAmount: '0',
        securityPoolAddress: '',
        selectedShareOutcome: 'yes',
        targetOutcomeIndexes: '',
    };
}
export function getDefaultForkAuctionFormState() {
    return {
        claimBidIndex: '0',
        claimBidTick: '0',
        depositIndexes: '',
        directForkQuestionId: '',
        directForkUniverseId: '0',
        refundBidIndex: '0',
        refundTick: '0',
        repMigrationOutcomes: 'yes',
        securityPoolAddress: '',
        selectedOutcome: 'yes',
        settlementAddress: '',
        submitBidAmount: '0',
        submitBidPrice: '0',
        vaultAddress: '',
    };
}
//# sourceMappingURL=marketForm.js.map