/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, getAddress, type Address, type Hash, type Hex } from 'viem'
import { getOpenOracleAddress, loadEscalationDeposits, migrateSharesFromUniverse, settleOracleReport } from '../contracts.js'
import { peripherals_openOracle_OpenOracle_OpenOracle, peripherals_tokens_ShareToken_ShareToken } from '../contractArtifact.js'

const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
const shareTokenAddress = getAddress('0x00000000000000000000000000000000000000b2')
const transactionHash = '0x00000000000000000000000000000000000000000000000000000000000000c3' satisfies Hash

type MockWriteClient = Parameters<typeof migrateSharesFromUniverse>[0]
type MockReadClient = Parameters<typeof loadEscalationDeposits>[0]

function createMockWriteClient(onSendTransaction: (request: { data?: Hex | undefined; gas?: bigint | undefined; to?: Address | undefined }) => void): MockWriteClient {
	return {
		readContract: async request => {
			if (request.functionName === 'universeId') return 12n
			if (request.functionName === 'shareToken') return shareTokenAddress
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		},
		sendTransaction: async request => {
			onSendTransaction(request)
			return transactionHash
		},
		waitForTransactionReceipt: async () => ({ status: 'success' }),
	} satisfies MockWriteClient
}

function createMockReadClient(readContract: MockReadClient['readContract']): MockReadClient {
	return {
		readContract,
	}
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

	test('loadEscalationDeposits continues paging past settled entries on a full page', async () => {
		const escalationGameAddress = getAddress('0x00000000000000000000000000000000000000d4')
		const depositor = getAddress('0x00000000000000000000000000000000000000e5')
		const readCalls: bigint[] = []
		const firstPage = Array.from({ length: 30 }, (_, index) => ({
			amount: index === 29 ? 0n : BigInt(index + 1),
			cumulativeAmount: BigInt(index + 1),
			depositor,
		}))
		const secondPage = [
			{
				amount: 31n,
				cumulativeAmount: 31n,
				depositor,
			},
		]
		const client = createMockReadClient(async request => {
			const args = Reflect.get(request, 'args')
			const startIndex = Array.isArray(args) ? args[1] : undefined
			if (typeof startIndex !== 'bigint') throw new Error('Expected pagination start index')
			readCalls.push(startIndex)
			if (startIndex === 0n) return firstPage
			if (startIndex === 30n) return secondPage
			throw new Error(`Unexpected start index: ${startIndex.toString()}`)
		})

		const deposits = await loadEscalationDeposits(client, escalationGameAddress, 'yes')

		expect(readCalls).toEqual([0n, 30n])
		expect(deposits).toHaveLength(30)
		expect(deposits.some(deposit => deposit.amount === 0n)).toBe(false)
		expect(deposits[28]?.depositIndex).toBe(28n)
		expect(deposits[29]?.depositIndex).toBe(30n)
	})
})
