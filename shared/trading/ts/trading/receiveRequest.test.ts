import { expect, test } from 'bun:test'
import { encodeAbiParameters, type Address } from '@zoltar/core-shared/evm/ethereum'
import { encodeReceiveRequest, receiveRequestParameter, type ReceiveRequest } from './receiveRequest.js'

const shareToken: Address = '0x00000000000000000000000000000000000000a1'
const pool: Address = '0x00000000000000000000000000000000000000a2'
const pair: Address = '0x00000000000000000000000000000000000000a3'
const recipient: Address = '0x00000000000000000000000000000000000000a4'

test('receive requests encode as one static tuple of words in component order', () => {
	const request: ReceiveRequest = [1, 0, shareToken, pool, pair, 5n, 6n, 1280n, 1281n, 1282n, 1, 10n, 11n, 12n, recipient, recipient, 99n]
	const encoded = encodeReceiveRequest(request)
	expect((encoded.length - 2) / 64).toBe(receiveRequestParameter.components.length)
	// A static tuple encodes exactly like its fields encoded in sequence.
	expect(encoded).toBe(encodeAbiParameters(receiveRequestParameter.components, request))
})
