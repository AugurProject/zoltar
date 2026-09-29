import { isHex, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { AnvilWindowEthereum } from '../AnvilWindowEthereum'

export type SplitSignature = { r: Hex; s: Hex; v: number }

export const PERMIT_TYPES = {
	Permit: [
		{ name: 'owner', type: 'address' },
		{ name: 'spender', type: 'address' },
		{ name: 'value', type: 'uint256' },
		{ name: 'nonce', type: 'uint256' },
		{ name: 'deadline', type: 'uint256' },
	],
} as const

const authorizationFields = [
	{ name: 'from', type: 'address' },
	{ name: 'to', type: 'address' },
	{ name: 'value', type: 'uint256' },
	{ name: 'validAfter', type: 'uint256' },
	{ name: 'validBefore', type: 'uint256' },
	{ name: 'nonce', type: 'bytes32' },
] as const

export const RECEIVE_WITH_AUTHORIZATION_TYPES = { ReceiveWithAuthorization: authorizationFields } as const
export const TRANSFER_WITH_AUTHORIZATION_TYPES = { TransferWithAuthorization: authorizationFields } as const
export const CANCEL_AUTHORIZATION_TYPES = {
	CancelAuthorization: [
		{ name: 'authorizer', type: 'address' },
		{ name: 'nonce', type: 'bytes32' },
	],
} as const

export const tokenDomain = (verifyingContract: Address, name: string, chainId = 1) => ({ chainId, name, version: '1', verifyingContract })

export function splitSignature(signature: string): SplitSignature {
	if (!isHex(signature) || signature.length !== 132) throw new Error('Expected a 65-byte signature')
	return {
		r: `0x${signature.slice(2, 66)}`,
		s: `0x${signature.slice(66, 130)}`,
		v: Number.parseInt(signature.slice(130, 132), 16),
	}
}

export async function signTypedDataV4(ethereum: AnvilWindowEthereum, signer: Address, typedData: object) {
	const signature = await ethereum.request({ method: 'eth_signTypedData_v4', params: [signer, JSON.stringify(typedData)] })
	if (typeof signature !== 'string') throw new Error('Typed-data signature missing')
	return splitSignature(signature)
}
