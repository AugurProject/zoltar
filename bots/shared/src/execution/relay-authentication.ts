import { getAddress, keccak256, type Address, type Hex } from '../ethereum.ts'

export type RelayAuthentication = {
	address: Address
	signMessage: (message: string | Uint8Array) => Promise<Hex>
}

export async function authenticatedRelayHeaders(body: string, authentication: RelayAuthentication) {
	const signature = await authentication.signMessage(keccak256(body))
	if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('Relay authentication signer returned an invalid signature')
	return {
		'content-type': 'application/json',
		'x-flashbots-signature': `${getAddress(authentication.address)}:${signature}`,
	}
}
