import { encodeAbiParameters, keccak256 } from '@zoltar/core-shared/evm/ethereum';
export function getCallerScopedSalt(caller, salt) {
    return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [caller, salt]));
}
