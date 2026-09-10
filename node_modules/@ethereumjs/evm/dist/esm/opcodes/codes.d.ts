import type { Common } from '@ethereumjs/common';
import { type CustomOpcode } from '../types.ts';
import type { OpHandler } from './functions.ts';
import type { AsyncDynamicGasHandler, SyncDynamicGasHandler } from './gas.ts';
export declare class Opcode {
    readonly code: number;
    readonly name: string;
    readonly fullName: string;
    readonly fee: number;
    readonly feeBigInt: bigint;
    readonly isAsync: boolean;
    readonly dynamicGas: boolean;
    readonly isInvalid: boolean;
    constructor({ code, name, fullName, fee, isAsync, dynamicGas, }: {
        code: number;
        name: string;
        fullName: string;
        fee: number;
        isAsync: boolean;
        dynamicGas: boolean;
    });
}
export type OpcodeList = Map<number, Opcode>;
type OpcodeContext = {
    dynamicGasHandlers: Map<number, AsyncDynamicGasHandler | SyncDynamicGasHandler>;
    handlers: Map<number, OpHandler>;
    opcodes: OpcodeList;
    opcodeMap: OpcodeMap;
};
export type OpcodeMapEntry = {
    opcodeInfo: Opcode;
    opHandler: OpHandler;
    gasHandler: AsyncDynamicGasHandler | SyncDynamicGasHandler;
};
export type OpcodeMap = OpcodeMapEntry[];
/**
 * Get suitable opcodes for the required hardfork.
 *
 * @param common {Common} Ethereumjs Common metadata object.
 * @param customOpcodes List with custom opcodes (see EVM `customOpcodes` option description).
 * @returns {OpcodeList} Opcodes dictionary object.
 */
export declare function getOpcodesForHF(common: Common, customOpcodes?: CustomOpcode[]): OpcodeContext;
export {};
//# sourceMappingURL=codes.d.ts.map