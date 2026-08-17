import { type Address } from '@zoltar/shared/ethereum';
import type { ForkOutcomeKey, MarketType, QuestionData, ReportingOutcomeKey, SecurityPoolSystemState } from '@zoltar/ui-core-shared/types/contracts.js';
type IntegerLike = bigint | number;
type SecurityVaultTuple = readonly [bigint, bigint, bigint, bigint] | readonly [bigint, bigint, bigint, bigint, bigint];
export type UniverseTuple = readonly [bigint, bigint, bigint, Address, bigint];
export type StagedOperationTuple = {
    operationAmountAttoRepOrAttoEth: bigint;
    operator: Address;
    operation: IntegerLike;
    targetVault: Address;
};
export type SecurityPoolDeploymentTuple = {
    initialReportPriorityFeeAttoEthPerGas: bigint;
    parent: Address;
    priceOracleManagerAndOperatorQueuer: Address;
    questionId: bigint;
    statoblastSecurityMultiplierBps: bigint;
    securityPool: Address;
    truthAuction: Address;
    universeId: bigint;
};
export type DeployedChildUniverseTuple = {
    forkQuestionId: bigint;
    forkTime: bigint;
    forkingOutcomeIndex: bigint;
    parentUniverseId: bigint;
    reputationToken: Address;
};
type EscalationGameTuple = readonly [bigint, bigint, bigint, bigint, bigint, [bigint, bigint, bigint], bigint, IntegerLike, bigint, boolean];
export declare function bigintToAddress(value: bigint): Address;
export declare function isStringArray(value: unknown): value is string[];
export declare function isBigintTriple(value: unknown): value is [bigint, bigint, bigint];
export declare function getMinBigintValue(values: bigint[]): bigint | undefined;
export declare function getProtocolPageOffset(pageIndex: number, pageSize: number): bigint;
export declare function hasTimestamp(value: unknown): value is {
    timestamp: bigint;
};
export declare function hasTimestampAndNumber(value: unknown): value is {
    timestamp: bigint;
    number: bigint;
};
export declare function requireUniverseTupleArray(value: unknown, context: string): UniverseTuple[];
export declare function requireStagedOperationTupleArray(value: unknown, context: string): StagedOperationTuple[];
export declare function requireSecurityPoolDeploymentTupleArray(value: unknown, context: string): SecurityPoolDeploymentTuple[];
export declare function requireDeployedChildUniverseTupleArray(value: unknown, context: string): DeployedChildUniverseTuple[];
export declare function requireEscalationGameTuple(value: unknown, context: string): EscalationGameTuple;
export declare function requireSecurityVaultTupleArray(value: unknown, context: string): SecurityVaultTuple[];
export declare function getQuestionId(questionData: QuestionData, outcomeOptions: readonly string[]): bigint;
export declare function getQuestionIdHex(questionId: bigint): string;
export declare function getReportingOutcomeValue(outcome: ReportingOutcomeKey): 0 | 1 | 2;
export declare function getReportingOutcomeKey(outcome: bigint | number): ReportingOutcomeKey | 'none';
export declare function getForkOutcomeKey(outcome: bigint | number, parentSecurityPoolAddress: Address): ForkOutcomeKey;
export declare function getEscalationSideLabel(key: ReportingOutcomeKey): "Invalid" | "Yes" | "No";
export declare function getSecurityPoolSystemState(value: bigint | number): SecurityPoolSystemState;
export declare function getMarketType(questionData: QuestionData, outcomeLabels: string[]): MarketType;
export {};
//# sourceMappingURL=helpers.d.ts.map