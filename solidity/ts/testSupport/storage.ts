import { encodeAbiParameters, keccak256, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'

/** Formats a storage slot as the 32-byte hex key expected by `eth_getStorageAt` and state overrides. */
export function formatStorageSlot(slot: bigint): Hex {
	return `0x${slot.toString(16).padStart(64, '0')}`
}

/** Solidity storage slot of `mapping(address => ...)` entry `key` whose mapping is declared at `mappingSlot`. */
export function getAddressMappingStorageSlot(key: Address, mappingSlot: bigint): bigint {
	return BigInt(keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [key, mappingSlot])))
}

/** Solidity storage slot of `mapping(uint256 => ...)` entry `key` whose mapping is declared at `mappingSlot`. */
export function getUintMappingStorageSlot(key: bigint, mappingSlot: bigint): bigint {
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [key, mappingSlot])))
}

/** Solidity storage slot of `mapping(int256 => ...)` entry `key` whose mapping is declared at `mappingSlot`. */
export function getIntMappingStorageSlot(key: bigint, mappingSlot: bigint): bigint {
	return BigInt(keccak256(encodeAbiParameters([{ type: 'int256' }, { type: 'uint256' }], [key, mappingSlot])))
}
