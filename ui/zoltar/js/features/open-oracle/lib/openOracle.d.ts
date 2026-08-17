import { type Address } from '@zoltar/shared/ethereum';
import type { OpenOracleCreateFormState } from '../../../types/app.js';
import type { OpenOracleReportDetails, OpenOracleReportSummary } from '@zoltar/ui-core-shared/types/contracts.js';
import { type TokenApprovalRequirement } from '@zoltar/ui-core-shared/lib/tokenApproval.js';
import { addOpenOracleBountyBuffer } from '../../../protocol/openOracleMath.js';
type OpenOracleReportStatus = 'Pending' | 'Disputed' | 'Settled';
export type OpenOracleSelectedReportActionMode = 'dispute' | 'settle' | 'read-only';
export { addOpenOracleBountyBuffer };
export type OpenOracleDisputeInputField = 'disputeNewAmount1' | 'disputeNewAmount2' | 'disputeTokenToSwap';
type OpenOracleGateMessage = {
    kind: 'hidden-loading' | 'visible';
    message: string;
};
type OpenOracleReportActionAvailability = {
    canAct: boolean;
    message: string | undefined;
};
export type OpenOracleDisputeSubmissionDetails = {
    blockMessage: OpenOracleGateMessage | undefined;
    canSubmit: boolean;
    expectedNewAmount1: bigint | undefined;
    inputFieldErrors: Partial<Record<OpenOracleDisputeInputField, string>>;
    inputBlockMessage: OpenOracleGateMessage | undefined;
    newAmount1: bigint | undefined;
    newAmount2: bigint | undefined;
    token1Approval: TokenApprovalRequirement;
    token1ContributionAmount: bigint | undefined;
    token1Decimals: number | undefined;
    token2Approval: TokenApprovalRequirement;
    token2ContributionAmount: bigint | undefined;
    token2Decimals: number | undefined;
};
export declare function formatOpenOracleSettleWriteErrorMessage(error: unknown, fallbackMessage?: string): any;
export declare function formatOpenOracleDisputeWriteErrorMessage(error: unknown, fallbackMessage?: string): any;
export declare function getOpenOracleCreateGuardMessage({ ethValueInput, isOnActiveAppChain, settlerRewardInput, walletConnected, walletBalanceAttoEth }: {
    ethValueInput: string;
    isOnActiveAppChain: boolean;
    settlerRewardInput: string;
    walletConnected: boolean;
    walletBalanceAttoEth: bigint | undefined;
}): any;
export declare const OPEN_ORACLE_CREATE_FIELD_ORDER: ReadonlyArray<keyof OpenOracleCreateFormState>;
export type OpenOracleCreateField = (typeof OPEN_ORACLE_CREATE_FIELD_ORDER)[number];
export type OpenOracleCreateContractFieldErrors = Partial<Record<'token1Address' | 'token2Address', string>>;
export type OpenOracleCreateValidation = {
    fieldErrors: Partial<Record<OpenOracleCreateField, string>>;
    firstInvalidField: OpenOracleCreateField | undefined;
    isValid: boolean;
    message: string | undefined;
};
export declare function getOpenOracleCreateValidation({ form, token1Decimals, token2Decimals }: {
    form: OpenOracleCreateFormState;
    token1Decimals?: number;
    token2Decimals?: number;
}): OpenOracleCreateValidation;
export declare function getOpenOracleCreateValidationMessage(parameters: {
    form: OpenOracleCreateFormState;
    token1Decimals?: number;
    token2Decimals?: number;
}): string | undefined;
export declare function getOpenOracleReportStatus(report: Pick<OpenOracleReportSummary, 'currentReporter' | 'disputeOccurred' | 'isDistributed' | 'reportTimestamp'>): OpenOracleReportStatus;
export declare function getOpenOracleReportStatusTone(status: OpenOracleReportStatus): 'blocked' | 'danger' | 'muted' | 'ok';
export declare function getOpenOracleSelectedReportActionMode(report: Pick<OpenOracleReportDetails, 'currentBlockNumber' | 'currentReporter' | 'currentTime' | 'disputeDelay' | 'disputeOccurred' | 'isDistributed' | 'reportTimestamp' | 'settlementTime' | 'timeType'>): OpenOracleSelectedReportActionMode;
export declare function getOpenOracleDisputeAvailability(report: Pick<OpenOracleReportDetails, 'currentBlockNumber' | 'currentReporter' | 'currentTime' | 'disputeDelay' | 'isDistributed' | 'reportTimestamp' | 'settlementTime' | 'timeType'>): OpenOracleReportActionAvailability;
export declare function getOpenOracleSettleAvailability(report: Pick<OpenOracleReportDetails, 'currentBlockNumber' | 'currentReporter' | 'currentTime' | 'isDistributed' | 'reportTimestamp' | 'settlementTime' | 'timeType'>): OpenOracleReportActionAvailability;
export declare function formatOpenOracleFeePercentage(feePercentage: bigint | undefined): string;
export declare function formatOpenOracleFeePercentageInput(feePercentage: bigint): string;
export declare function parseOpenOracleFeePercentageInput(value: string, label: string): number;
export declare function parseOpenOracleCreateFormSubmission({ form, token1Decimals, token2Decimals }: {
    form: OpenOracleCreateFormState;
    token1Decimals: number;
    token2Decimals: number;
}): {
    disputeDelay: number;
    escalationHalt: any;
    exactToken1Report: any;
    initialToken2Amount: any;
    ethValueAttoEth: any;
    feePercentage: number;
    multiplier: number;
    protocolFee: number;
    settlementTime: number;
    settlerRewardAttoEth: any;
    token1Address: any;
    token2Address: any;
};
export declare function formatOpenOracleMultiplier(multiplier: bigint | undefined): string;
export declare function deriveOpenOracleDisputeSubmissionDetails({ accountAddress, approvedToken1Amount, approvedToken2Amount, disputeNewAmount1Input, disputeNewAmount2Input, disputeTokenToSwap, reportDetails, token1AllowanceError, token1Balance, token1BalanceError, token1Decimals, token2AllowanceError, token2Balance, token2BalanceError, token2Decimals, }: {
    accountAddress?: Address | undefined;
    approvedToken1Amount: bigint | undefined;
    approvedToken2Amount: bigint | undefined;
    disputeNewAmount1Input: string;
    disputeNewAmount2Input: string;
    disputeTokenToSwap: 'token1' | 'token2';
    reportDetails: Pick<OpenOracleReportDetails, 'currentAmount1' | 'currentAmount2' | 'currentBlockNumber' | 'currentReporter' | 'currentTime' | 'disputeDelay' | 'escalationHalt' | 'feePercentage' | 'isDistributed' | 'multiplier' | 'protocolFee' | 'reportTimestamp' | 'settlementTime' | 'timeType' | 'token1' | 'token1Symbol' | 'token2' | 'token2Symbol'> | undefined;
    token1AllowanceError: string | undefined;
    token1Balance: bigint | undefined;
    token1BalanceError: string | undefined;
    token1Decimals: number | undefined;
    token2AllowanceError: string | undefined;
    token2Balance: bigint | undefined;
    token2BalanceError: string | undefined;
    token2Decimals: number | undefined;
}): OpenOracleDisputeSubmissionDetails;
export declare function getOracleLastPriceDisplay({ lastPrice, lastSettlementTimestamp }: {
    lastPrice: bigint;
    lastSettlementTimestamp: bigint;
}): string;
export declare function getOraclePriceValidityPresentation({ currentTimestamp, lastSettlementTimestamp, priceValidUntilTimestamp }: {
    currentTimestamp: bigint;
    lastSettlementTimestamp: bigint;
    priceValidUntilTimestamp: bigint | undefined;
}): {
    text: string;
    tone: "danger";
} | {
    text: string;
    tone: "success";
} | undefined;
//# sourceMappingURL=openOracle.d.ts.map