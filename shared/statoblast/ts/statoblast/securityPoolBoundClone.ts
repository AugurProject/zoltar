import { getAddress, toHex, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'

export function boundCloneRuntimeCode(implementation: Address, bindings: Hex): Hex {
	return `0x363d3d373d3d3d363d73${implementation.slice(2)}5af43d82803e903d91602b57fd5bf3${bindings.slice(2)}`
}

/** Verify the complete EIP-1167 runtime and immutable bindings. The caller authenticates the implementation. */
export function verifyBoundCloneCode(code: Hex | undefined, expected: Hex, label: string) {
	if (code?.toLowerCase() !== expected.toLowerCase()) throw new Error(`Could not verify the code or linked addresses for the ${label}.`)
}

/** Extract the implementation from a verified forwarder. Authenticate its runtime separately. */
export function boundCloneImplementation(code: Hex | undefined, bindings: Hex, label: string): Address {
	if (code === undefined || code.length < 92) throw new Error(`Could not verify the code or linked addresses for the ${label}.`)
	const implementation = getAddress(`0x${code.slice(22, 62)}`)
	verifyBoundCloneCode(code, boundCloneRuntimeCode(implementation, bindings), label)
	return implementation
}

export function universeCloneBindings(universeId: bigint, token: Address): Hex {
	return `${toHex(universeId, { size: 31 })}${token.slice(2)}`
}
