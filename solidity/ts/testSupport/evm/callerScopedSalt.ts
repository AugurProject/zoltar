import { encodeAbiParameters, keccak256, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'

export function getCallerScopedSalt(caller: Address, salt: Hex) {
	return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [caller, salt]))
}
