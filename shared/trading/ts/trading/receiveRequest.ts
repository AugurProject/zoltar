import { encodeAbiParameters, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'

/** @internal ABI of the TwoWayConstantProductRouter request carried in ERC-1155 receive callback data; tests decode router payloads with it. */
export const receiveRequestParameter = {
	type: 'tuple',
	components: [
		{ name: 'version', type: 'uint8' },
		{ name: 'operation', type: 'uint8' },
		{ name: 'shareToken', type: 'address' },
		{ name: 'securityPool', type: 'address' },
		{ name: 'pair', type: 'address' },
		{ name: 'universeId', type: 'uint248' },
		{ name: 'questionId', type: 'uint256' },
		{ name: 'invalidTokenId', type: 'uint256' },
		{ name: 'yesTokenId', type: 'uint256' },
		{ name: 'noTokenId', type: 'uint256' },
		{ name: 'longOutcome', type: 'uint8' },
		{ name: 'completeSetShares', type: 'uint256' },
		{ name: 'maxLongSharesIn', type: 'uint256' },
		{ name: 'minEthOut', type: 'uint256' },
		{ name: 'payoutRecipient', type: 'address' },
		{ name: 'refundRecipient', type: 'address' },
		{ name: 'deadline', type: 'uint256' },
	],
} as const

/** Positional receive request fields, in `receiveRequestParameter` component order. */
export type ReceiveRequest = readonly [
	version: number,
	operation: number,
	shareToken: Address,
	securityPool: Address,
	pair: Address,
	universeId: bigint,
	questionId: bigint,
	invalidTokenId: bigint,
	yesTokenId: bigint,
	noTokenId: bigint,
	longOutcome: number,
	completeSetShares: bigint,
	maxLongSharesIn: bigint,
	minEthOut: bigint,
	payoutRecipient: Address,
	refundRecipient: Address,
	deadline: bigint,
]

export function encodeReceiveRequest(request: ReceiveRequest): Hex {
	return encodeAbiParameters([receiveRequestParameter], [request])
}
