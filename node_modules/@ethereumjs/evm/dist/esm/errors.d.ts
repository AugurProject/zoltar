export type EVMErrorType = (typeof EVMErrorMessage)[keyof typeof EVMErrorMessage];
export declare const EVMErrorTypeString = "EVMError";
declare const EVMErrorMessage: {
    readonly OUT_OF_GAS: "out of gas";
    readonly CODESTORE_OUT_OF_GAS: "code store out of gas";
    readonly CODESIZE_EXCEEDS_MAXIMUM: "code size to deposit exceeds maximum code size";
    readonly STACK_UNDERFLOW: "stack underflow";
    readonly STACK_OVERFLOW: "stack overflow";
    readonly INVALID_JUMP: "invalid JUMP";
    readonly INVALID_OPCODE: "invalid opcode";
    readonly OUT_OF_RANGE: "value out of range";
    readonly REVERT: "revert";
    readonly STATIC_STATE_CHANGE: "static state change";
    readonly INTERNAL_ERROR: "internal error";
    readonly CREATE_COLLISION: "create collision";
    readonly STOP: "stop";
    readonly REFUND_EXHAUSTED: "refund exhausted";
    readonly VALUE_OVERFLOW: "value overflow";
    readonly INSUFFICIENT_BALANCE: "insufficient balance";
    readonly INVALID_BYTECODE_RESULT: "invalid bytecode deployed";
    readonly INITCODE_SIZE_VIOLATION: "initcode exceeds max initcode size";
    readonly INVALID_INPUT_LENGTH: "invalid input length";
    readonly INVALID_EOF_FORMAT: "invalid EOF format";
    readonly BLS_12_381_INVALID_INPUT_LENGTH: "invalid input length";
    readonly BLS_12_381_POINT_NOT_ON_CURVE: "point not on curve";
    readonly BLS_12_381_INPUT_EMPTY: "input is empty";
    readonly BLS_12_381_FP_NOT_IN_FIELD: "fp point not in field";
    readonly BN254_FP_NOT_IN_FIELD: "fp point not in field";
    readonly INVALID_COMMITMENT: "kzg commitment does not match versioned hash";
    readonly INVALID_INPUTS: "kzg inputs invalid";
    readonly INVALID_PROOF: "kzg proof invalid";
};
export declare class EVMError {
    error: EVMErrorType;
    errorType: string;
    static errorMessages: Record<keyof typeof EVMErrorMessage, EVMErrorType>;
    constructor(error: EVMErrorType);
}
export {};
//# sourceMappingURL=errors.d.ts.map