/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, getAddress, type Address, type Hash, type Hex } from 'viem'
import { migrateSharesFromUniverse } from '../contracts.js'
import { peripherals_tokens_ShareToken_ShareToken } from '../contractArtifact.js'
import type { WriteClient } from '../types/contracts.js'

const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
const shareTokenAddress = getAddress('0x00000000000000000000000000000000000000b2')
const transactionHash = '0x00000000000000000000000000000000000000000000000000000000000000c3' satisfies Hash

function createMockWriteClient(onSendTransaction: (request: { data?: Hex | undefined; to?: Address | undefined }) => void): WriteClient {
	const client = {
		readContract: async ({ functionName }: { functionName: string }) => {
			if (functionName === 'universeId') return 12n
			if (functionName === 'shareToken') return shareTokenAddress
			throw new Error(`Unexpected readContract function: ${functionName}`)
		},
		sendTransaction: async (request: { data?: Hex | undefined; to?: Address | undefined }) => {
			onSendTransaction(request)
			return transactionHash
		},
		waitForTransactionReceipt: async () => ({ status: 'success' as const }),
	}

	return client as unknown as WriteClient
}

describe('contracts helpers', () => {
	test('migrateSharesFromUniverse sorts target outcomes before submission without deduplicating', async () => {
		let capturedData: Hex | undefined
		let capturedTo: Address | undefined
		const client = createMockWriteClient(request => {
			capturedData = request.data
			capturedTo = request.to
		})

		const result = await migrateSharesFromUniverse(client, securityPoolAddress, 'yes', [7n, 3n, 7n])

		expect(capturedTo).toBe(shareTokenAddress)
		expect(capturedData).toBeDefined()
		const decodedCall = decodeFunctionData({
			abi: peripherals_tokens_ShareToken_ShareToken.abi,
			data: capturedData ?? ('0x' satisfies Hex),
		})
		expect(decodedCall.functionName).toBe('migrate')
		expect(decodedCall.args?.[1]).toEqual([3n, 7n, 7n])
		expect(result.targetOutcomeIndexes).toEqual([3n, 7n, 7n])
	})
})
