import { type Address } from '@zoltar/shared/ethereum';
export declare function requireArrayValue(value: unknown, context: string): readonly unknown[];
export declare function requireTupleValue(value: unknown, length: number, context: string): readonly unknown[];
export declare function requireBigintValue(value: unknown, context: string): bigint;
export declare function requireIntegerLikeValue(value: unknown, context: string): number | bigint;
export declare function requireBooleanValue(value: unknown, context: string): value is true;
export declare function requireAddressValue(value: unknown, context: string): Address;
export declare function requireObjectValue(value: unknown, context: string): object;
//# sourceMappingURL=decoders.d.ts.map