import type { ReportingOutcomeKey } from '../types/contracts.js';
import { type Address, type Hex } from '@zoltar/shared/ethereum';
export declare function tryParseAddressInput(value: string): Address | undefined;
export declare function parseAddressInput(value: string, label: string): Address;
export declare function resolveOptionalAddressInput(value: string | undefined, fallbackAddress: Address, label: string): `0x${string}`;
export declare function parseBytes32Input(value: string, label: string): Hex;
export declare function parseReportIdInput(value: string): bigint;
export declare function parseOptionalBigIntInput(value: string): bigint | undefined;
export declare function parseBigIntListInput(value: string, label: string): bigint[];
export declare function tryParseBigIntListInput(value: string): bigint[] | undefined;
export declare function resolveOptionalBigIntListInput(value: string, fallback: bigint[], label: string): bigint[];
export declare function parseReportingOutcomeInput(value: string): ReportingOutcomeKey;
export declare function getReportingOutcomeKey(outcome: ReportingOutcomeKey | bigint): ReportingOutcomeKey;
export declare function approvalShortage(amount: bigint | undefined, allowance: bigint | undefined): bigint | undefined;
export declare function approvalTargetAmount(amount: bigint | undefined, allowance: bigint | undefined): bigint | undefined;
export declare function balanceShortage(amount: bigint | undefined, balance: bigint | undefined): bigint | undefined;
export declare function parseReportingOutcomeListInput(value: string, label: string): ReportingOutcomeKey[];
//# sourceMappingURL=inputs.d.ts.map