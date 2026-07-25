import { privateKeyToAccount, type Hex } from '@zoltar/shared/ethereum'

export function signerCandidate(value: unknown) {
	if (value === null) return { address: undefined, privateKey: undefined }
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('Private key must be null or a 32-byte 0x-prefixed value')
	const privateKey = value as Hex
	const address = privateKeyToAccount(privateKey).address
	return { address, privateKey }
}
