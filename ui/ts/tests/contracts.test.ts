/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, getAddress, type Address, type Hash, type Hex } from 'viem'
import { getOpenOracleAddress, migrateSharesFromUniverse, settleOracleReport } from '../contracts.js'
import { peripherals_openOracle_OpenOracle_OpenOracle, peripherals_tokens_ShareToken_ShareToken } from '../contractArtifact.js'
import type { WriteClient } from '../types/contracts.js'

const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
const shareTokenAddress = getAddress('0x00000000000000000000000000000000000000b2')
const transactionHash = '0x00000000000000000000000000000000000000000000000000000000000000c3' satisfies Hash

function createMockWriteClient(onSendTransaction: (request: { data?: Hex | undefined; gas?: bigint | undefined; to?: Address | null | undefined }) => void): WriteClient {
	const client = {} as WriteClient
	const readContract: WriteClient['readContract'] = async ({ functionName }) => {
		if (functionName === 'universeId') return 12n as never
		if (functionName === 'shareToken') return shareTokenAddress as never
		throw new Error(`Unexpected readContract function: ${functionName}`)
	}
	const sendTransaction: WriteClient['sendTransaction'] = async request => {
		onSendTransaction(request)
		return transactionHash
	}
	const waitForTransactionReceipt: WriteClient['waitForTransactionReceipt'] = async () => ({ status: 'success' }) as never
	client.readContract = readContract
	client.sendTransaction = sendTransaction
	client.waitForTransactionReceipt = waitForTransactionReceipt

	return client
}

describe('contracts helpers', () => {
	test('migrateSharesFromUniverse sorts target outcomes before submission without deduplicating', async () => {
		let capturedData: Hex | undefined
		let capturedTo: Address | null | undefined
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

	test('settleOracleReport sends settle with an explicit gas limit', async () => {
		let capturedData: Hex | undefined
		let capturedGas: bigint | undefined
		let capturedTo: Address | null | undefined
		const client = createMockWriteClient(request => {
			capturedData = request.data
			capturedGas = request.gas
			capturedTo = request.to
		})

		await settleOracleReport(client, getOpenOracleAddress(), 7n)

		expect(capturedTo).toBe(getOpenOracleAddress())
		expect(capturedGas).toBe(5_000_000n)
		expect(capturedData).toBeDefined()
		const decodedCall = decodeFunctionData({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			data: capturedData ?? ('0x' satisfies Hex),
		})
		expect(decodedCall.functionName).toBe('settle')
		expect(decodedCall.args).toEqual([7n])
	})
})
