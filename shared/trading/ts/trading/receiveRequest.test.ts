import { expect, test } from 'bun:test'
import { encodeAbiParameters, type Address } from '@zoltar/core-shared/evm/ethereum'
import { encodeReceiveRequest, receiveRequestParameter, type ReceiveRequest } from './receiveRequest.js'

const pool: Address = '0x00000000000000000000000000000000000000a2'
const pair: Address = '0x00000000000000000000000000000000000000a3'
const recipient: Address = '0x00000000000000000000000000000000000000a4'

test('receive requests encode as one static tuple of words in component order', () => {
	const request: ReceiveRequest = [3, 0, pool, pair, 1, 10n, 11n, 12n, recipient, recipient, 99n, 17n]
	const encoded = encodeReceiveRequest(request)
	expect((encoded.length - 2) / 2).toBe(12 * 32)
	expect((encoded.length - 2) / 64).toBe(receiveRequestParameter.components.length)
	// A static tuple encodes exactly like its fields encoded in sequence.
	expect(encoded).toBe(encodeAbiParameters(receiveRequestParameter.components, request))
})
