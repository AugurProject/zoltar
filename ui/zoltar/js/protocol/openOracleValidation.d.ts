import { type Address } from '@zoltar/shared/ethereum';
export declare const OPEN_ORACLE_PERCENTAGE_PRECISION: bigint;
export declare const OPEN_ORACLE_MULTIPLIER_PRECISION = 100n;
export type OpenOracleCreateValidationParameters = {
    disputeDelay: bigint;
    escalationHalt: bigint;
    exactToken1Report: bigint;
    initialToken2Amount: bigint;
    ethValueAttoEth: bigint;
    feePercentage: bigint;
    multiplier: bigint;
    protocolFee: bigint;
    settlementTime: bigint;
    settlerRewardAttoEth: bigint;
    token1Address: Address;
    token2Address: Address;
};
export type OpenOracleCreateParameterValidation = {
    field: keyof OpenOracleCreateValidationParameters;
    message: string;
};
export declare function getOpenOracleCreateParameterValidation({ disputeDelay, escalationHalt, exactToken1Report, initialToken2Amount, ethValueAttoEth, feePercentage, multiplier, protocolFee, settlementTime, settlerRewardAttoEth, token1Address, token2Address }: OpenOracleCreateValidationParameters, { skipToken1MagnitudeValidation }?: {
    skipToken1MagnitudeValidation?: boolean;
}): OpenOracleCreateParameterValidation | undefined;
export declare function getOpenOracleCreateParameterValidationMessage(parameters: OpenOracleCreateValidationParameters, options?: {
    skipToken1MagnitudeValidation?: boolean;
}): string | undefined;
//# sourceMappingURL=openOracleValidation.d.ts.map