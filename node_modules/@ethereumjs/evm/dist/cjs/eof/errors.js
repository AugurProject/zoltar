"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EOFErrorMessage = void 0;
exports.validationErrorMsg = validationErrorMsg;
exports.validationError = validationError;
const util_1 = require("@ethereumjs/util");
exports.EOFErrorMessage = {
    OUT_OF_BOUNDS: 'Trying to read out of bounds',
    VERIFY_UINT: 'Uint does not match expected value ',
    VERIFY_BYTES: 'Bytes do not match expected value',
    FORMAT: 'err: invalid format',
    MAGIC: 'err: invalid magic',
    VERSION: 'err: invalid eof version',
    KIND_TYPE: 'err: expected kind types',
    KIND_CODE: 'err: expected kind code',
    KIND_DATA: 'err: expected kind data',
    TERMINATOR: 'err: expected terminator',
    TYPE_SIZE: 'missing type size',
    INVALID_TYPE_SIZE: 'err: type section size invalid',
    CODE_SIZE: 'missing code size',
    CODE_SECTION_SIZE: 'code section should be at least one byte',
    INVALID_CODE_SIZE: 'code size does not match type size',
    DATA_SIZE: 'missing data size',
    CONTAINER_SIZE: 'missing container size',
    CONTAINER_SECTION_SIZE: 'container section should at least contain one section and at most 255 sections',
    TYPE_SECTIONS: 'err: mismatch of code sections count and type signatures',
    INPUTS: 'expected inputs',
    OUTPUTS: 'expected outputs',
    MAX_INPUTS: 'inputs exceeds 127, the maximum, got: ',
    MAX_OUTPUTS: 'outputs exceeds 127, the maximum, got: ',
    CODE0_INPUTS: 'first code section should have 0 inputs',
    CODE0_OUTPUTS: 'first code section should have 0x80 (terminating section) outputs',
    MAX_STACK_HEIGHT: 'expected maxStackHeight',
    MAX_STACK_HEIGHT_LIMIT: 'stack height limit of 1024 exceeded: ',
    MIN_CODE_SECTIONS: 'should have at least 1 code section',
    CODE_SECTION: 'expected a code section',
    DATA_SECTION: 'Expected data section',
    CONTAINER_SECTION: 'expected a container section',
    CONTAINER_SECTION_MIN: 'container section should be at least 1 byte',
    INVALID_EOF_CREATE_TARGET: 'EOFCREATE targets an undefined container',
    INVALID_RETURN_CONTRACT_TARGET: 'RETURNCONTRACT targets an undefined container',
    CONTAINER_DOUBLE_TYPE: 'Container is targeted by both EOFCREATE and RETURNCONTRACT',
    UNREACHABLE_CONTAINER_SECTIONS: 'Unreachable containers (by both EOFCREATE and RETURNCONTRACT)',
    CONTAINER_TYPE_ERROR: 'Container contains opcodes which this mode (deployment mode / init code / runtime mode) cannot have',
    DANGLING_BYTES: 'got dangling bytes in body',
    INVALID_OPCODE: 'invalid opcode',
    INVALID_TERMINATOR: 'invalid terminating opcode',
    OPCODE_INTERMEDIATES_OOB: 'invalid opcode: intermediates out-of-bounds',
    INVALID_RJUMP: 'invalid rjump* target',
    INVALID_CALL_TARGET: 'invalid callf/jumpf target',
    INVALID_CALLF_RETURNING: 'invalid callf: calls to non-returning function',
    INVALID_STACK_HEIGHT: 'invalid stack height',
    INVALID_JUMPF: 'invalid jumpf target (output count)',
    INVALID_RETURNING_SECTION: 'invalid returning code section: section is not returning',
    RETURNING_NO_RETURN: 'invalid section: section should return but has no RETF/JUMP to return',
    RJUMPV_TABLE_SIZE0: 'invalid RJUMPV: table size 0',
    UNREACHABLE_CODE_SECTIONS: 'unreachable code sections',
    UNREACHABLE_CODE: 'unreachable code (by forward jumps)',
    DATALOADN_OOB: 'DATALOADN reading out of bounds',
    MAX_STACK_HEIGHT_VIOLATION: 'Max stack height does not match the reported max stack height',
    STACK_UNDERFLOW: 'Stack underflow',
    STACK_OVERFLOW: 'Stack overflow',
    UNSTABLE_STACK: 'Unstable stack (can reach stack under/overflow by jumps)',
    RETF_NO_RETURN: 'Trying to return to undefined function',
    RETURN_STACK_OVERFLOW: 'Return stack overflow',
    INVALID_EXTCALL_TARGET: 'invalid extcall target: address > 20 bytes',
    INVALID_RETURN_CONTRACT_DATA_SIZE: 'invalid RETURNCONTRACT: data size lower than expected',
};
function validationErrorMsg(type, ...args) {
    switch (type) {
        case exports.EOFErrorMessage.OUT_OF_BOUNDS: {
            return exports.EOFErrorMessage.OUT_OF_BOUNDS + ` at pos: ${args[0]}: ${args[1]}`;
        }
        case exports.EOFErrorMessage.VERIFY_BYTES: {
            return exports.EOFErrorMessage.VERIFY_BYTES + ` at pos: ${args[0]}: ${args[1]}`;
        }
        case exports.EOFErrorMessage.VERIFY_UINT: {
            return exports.EOFErrorMessage.VERIFY_UINT + `at pos: ${args[0]}: ${args[1]}`;
        }
        case exports.EOFErrorMessage.TYPE_SIZE: {
            return exports.EOFErrorMessage.TYPE_SIZE + args[0];
        }
        case exports.EOFErrorMessage.INVALID_TYPE_SIZE: {
            return exports.EOFErrorMessage.INVALID_TYPE_SIZE + args[0];
        }
        case exports.EOFErrorMessage.INVALID_CODE_SIZE: {
            return exports.EOFErrorMessage.INVALID_CODE_SIZE + args[0];
        }
        case exports.EOFErrorMessage.INPUTS: {
            return `${exports.EOFErrorMessage.INPUTS} - typeSection ${args[0]}`;
        }
        case exports.EOFErrorMessage.OUTPUTS: {
            return `${exports.EOFErrorMessage.OUTPUTS} - typeSection ${args[0]}`;
        }
        case exports.EOFErrorMessage.CODE0_INPUTS: {
            return `first code section should have 0 inputs`;
        }
        case exports.EOFErrorMessage.CODE0_OUTPUTS: {
            return `first code section should have 0 outputs`;
        }
        case exports.EOFErrorMessage.MAX_INPUTS: {
            return exports.EOFErrorMessage.MAX_INPUTS + `${args[1]} - code section ${args[0]}`;
        }
        case exports.EOFErrorMessage.MAX_OUTPUTS: {
            return exports.EOFErrorMessage.MAX_OUTPUTS + `${args[1]} - code section ${args[0]}`;
        }
        case exports.EOFErrorMessage.CODE_SECTION: {
            return `expected code: codeSection ${args[0]}: `;
        }
        case exports.EOFErrorMessage.DATA_SECTION: {
            return exports.EOFErrorMessage.DATA_SECTION;
        }
        case exports.EOFErrorMessage.MAX_STACK_HEIGHT: {
            return `${exports.EOFErrorMessage.MAX_STACK_HEIGHT} - typeSection ${args[0]}: `;
        }
        case exports.EOFErrorMessage.MAX_STACK_HEIGHT_LIMIT: {
            return `${exports.EOFErrorMessage.MAX_STACK_HEIGHT_LIMIT}, got: ${args[1]} - typeSection ${args[0]}`;
        }
        case exports.EOFErrorMessage.DANGLING_BYTES: {
            return exports.EOFErrorMessage.DANGLING_BYTES;
        }
        default: {
            return type;
        }
    }
}
function validationError(type, ...args) {
    switch (type) {
        case exports.EOFErrorMessage.OUT_OF_BOUNDS: {
            const pos = args[0];
            if (pos === 0 || pos === 2 || pos === 3 || pos === 6) {
                throw (0, util_1.EthereumJSErrorWithoutCode)(args[1]);
            }
            throw (0, util_1.EthereumJSErrorWithoutCode)(exports.EOFErrorMessage.OUT_OF_BOUNDS + ` `);
        }
        case exports.EOFErrorMessage.VERIFY_BYTES: {
            const pos = args[0];
            if (pos === 0 || pos === 2 || pos === 3 || pos === 6) {
                throw (0, util_1.EthereumJSErrorWithoutCode)(args[1]);
            }
            throw (0, util_1.EthereumJSErrorWithoutCode)(exports.EOFErrorMessage.VERIFY_BYTES + ` at pos: ${args[0]}: ${args[1]}`);
        }
        case exports.EOFErrorMessage.VERIFY_UINT: {
            const pos = args[0];
            if (pos === 0 || pos === 2 || pos === 3 || pos === 6 || pos === 18) {
                throw (0, util_1.EthereumJSErrorWithoutCode)(args[1]);
            }
            throw (0, util_1.EthereumJSErrorWithoutCode)(exports.EOFErrorMessage.VERIFY_UINT + `at pos: ${args[0]}: ${args[1]}`);
        }
        case exports.EOFErrorMessage.TYPE_SIZE: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(exports.EOFErrorMessage.TYPE_SIZE + args[0]);
        }
        case exports.EOFErrorMessage.TYPE_SECTIONS: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(`${exports.EOFErrorMessage.TYPE_SECTIONS} (types ${args[0]} code ${args[1]})`);
        }
        case exports.EOFErrorMessage.INVALID_TYPE_SIZE: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(exports.EOFErrorMessage.INVALID_TYPE_SIZE);
        }
        case exports.EOFErrorMessage.INVALID_CODE_SIZE: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(exports.EOFErrorMessage.INVALID_CODE_SIZE + args[0]);
        }
        case exports.EOFErrorMessage.INPUTS: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(`${exports.EOFErrorMessage.INPUTS} - typeSection ${args[0]}`);
        }
        case exports.EOFErrorMessage.OUTPUTS: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(`${exports.EOFErrorMessage.OUTPUTS} - typeSection ${args[0]}`);
        }
        case exports.EOFErrorMessage.CODE0_INPUTS: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(`first code section should have 0 inputs`);
        }
        case exports.EOFErrorMessage.CODE0_OUTPUTS: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(`first code section should have 0 outputs`);
        }
        case exports.EOFErrorMessage.MAX_INPUTS: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(exports.EOFErrorMessage.MAX_INPUTS + `${args[1]} - code section ${args[0]}`);
        }
        case exports.EOFErrorMessage.MAX_OUTPUTS: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(exports.EOFErrorMessage.MAX_OUTPUTS + `${args[1]} - code section ${args[0]}`);
        }
        case exports.EOFErrorMessage.CODE_SECTION: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(`expected code: codeSection ${args[0]}: `);
        }
        case exports.EOFErrorMessage.DATA_SECTION: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(exports.EOFErrorMessage.DATA_SECTION);
        }
        case exports.EOFErrorMessage.MAX_STACK_HEIGHT: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(`${exports.EOFErrorMessage.MAX_STACK_HEIGHT} - typeSection ${args[0]}: `);
        }
        case exports.EOFErrorMessage.MAX_STACK_HEIGHT_LIMIT: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(`${exports.EOFErrorMessage.MAX_STACK_HEIGHT_LIMIT}, got: ${args[1]} - typeSection ${args[0]}`);
        }
        case exports.EOFErrorMessage.DANGLING_BYTES: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(exports.EOFErrorMessage.DANGLING_BYTES);
        }
        default: {
            throw (0, util_1.EthereumJSErrorWithoutCode)(type);
        }
    }
}
//# sourceMappingURL=errors.js.map