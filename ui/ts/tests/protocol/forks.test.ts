/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, getAddress, zeroAddress, type Address, type Hex } from '@zoltar/shared/ethereum'
import { depositRepToSecurityPool, finalizeSecurityPoolTruthAuction, loadForkAuctionDetails, migrateSharesFromUniverse } from '../../protocol/index.js'
import { getForkOutcomeKey } from '../../protocol/helpers.js'
import { peripherals_tokens_ShareToken_ShareToken } from '../../contractArtifact.js'
import { asWriteClient, createBlockWithTimestamp, createMockLoaderClient, createMockWriteClient, getContractFunctionName } from './testSupport.js'

const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
const shareTokenAddress = getAddress('0x00000000000000000000000000000000000000b2')
const truthAuctionAddress = getAddress('0x00000000000000000000000000000000000000f6')
const escalationGameAddress = getAddress('0x00000000000000000000000000000000000000e6')
const defaultForkData = [0n, zeroAddress, 0n, 0n, 0n, 0n, 0n, 0n, false, false, 0n] as const

function createForkMockWriteClient(onSendTransaction: (request: { data?: Hex | undefined; gas?: bigint | undefined; to?: Address | null | undefined }) => void) {
	return createMockWriteClient(onSendTransaction, async request => {
		if (request.functionName === 'universeId') return 12n
		if (request.functionName === 'shareToken') return shareTokenAddress
		if (request.functionName === 'getOwnForkMigrationStatus') return [false, 0n, 0n, 0n, 0n]
		if (request.functionName === 'getVaultCount') return 0n
		if (request.functionName === 'escalationGame') return escalationGameAddress
		if (request.functionName === 'getDepositsByOutcomeLength') return 0n
		throw new Error(`Unexpected readContract function: ${request.functionName}`)
	})
}

describe('forks protocol client', () => {
	test('finalizeSecurityPoolTruthAuction sends no repair contribution', async () => {
		let capturedValue: bigint | undefined
		const client = createMockWriteClient(request => {
			capturedValue = request.value
		})

		await finalizeSecurityPoolTruthAuction(asWriteClient(client), securityPoolAddress, 12n)

		expect(capturedValue).toBeUndefined()
	})

	test('migrateSharesFromUniverse sorts target outcomes before submission without deduplicating', async () => {
		let capturedData: Hex | undefined
		let capturedTo: Address | null | undefined
		const client = createForkMockWriteClient(request => {
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

	test('getForkOutcomeKey treats the default root-pool fork outcome as none', () => {
		expect(getForkOutcomeKey(0n, getAddress('0x0000000000000000000000000000000000000000'))).toBe('none')
		expect(getForkOutcomeKey(0n, securityPoolAddress)).toBe('invalid')
		expect(getForkOutcomeKey(1n, securityPoolAddress)).toBe('yes')
	})

	test('depositRepToSecurityPool rejects zero amounts before encoding a transaction', async () => {
		let sendTransactionCount = 0
		const client = createForkMockWriteClient(() => {
			sendTransactionCount += 1
		})

		await expect(depositRepToSecurityPool(asWriteClient(client), securityPoolAddress, 0n)).rejects.toThrow('REP deposit amount must be greater than zero')
		expect(sendTransactionCount).toBe(0)
	})

	test('loadForkAuctionDetails keeps the default root-pool fork outcome unset and inactive', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(5n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				if (getContractFunctionName(firstContract) === 'questionId') {
					return [questionId, zeroAddress, 1n, 0n, zeroAddress, 0n, defaultForkData, 3n, [0n, 0n, 0n]]
				}
				if (getContractFunctionName(firstContract) === 'getForkTime') return [0n]
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'getOwnForkMigrationStatus') return [false, 0n, 0n, 0n, 0n]
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const details = await loadForkAuctionDetails(client, securityPoolAddress)

		expect(details.parentSecurityPoolAddress).toBe(zeroAddress)
		expect(details.forkOutcome).toBe('none')
		expect(details.hasForkActivity).toBe(false)
		expect(details.ownForkRepBuckets).toBeUndefined()
	})

	test('loadForkAuctionDetails rejects malformed fork data instead of casting tuple reads', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(5n),
			multicall: async request => {
				const firstContract = request.contracts[0]
				if (getContractFunctionName(firstContract) === 'questionId') {
					return [questionId, zeroAddress, 1n, 0n, zeroAddress, 0n, [0n, zeroAddress, 0n, 'bad-migrated-rep', 0n, 0n, 0n, 0n, false, false, 0n], 3n, [0n, 0n, 0n]]
				}
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'getOwnForkMigrationStatus') return [false, 0n, 0n, 0n, 0n]
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		await expect(loadForkAuctionDetails(client, securityPoolAddress)).rejects.toThrow('Unexpected security pool fork data migrated REP response')
	})

	test('loadForkAuctionDetails preserves migration end time after truth auction has started', async () => {
		const questionId = 1n
		const forkTime = 1_000n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(5n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				if (getContractFunctionName(firstContract) === 'questionId') {
					return [questionId, truthAuctionAddress, 1n, 0n, zeroAddress, 0n, [0n, zeroAddress, 1n, 0n, 0n, 0n, 0n, 0n, false, false, 1n], 4n, [0n, 0n, 0n]]
				}
				if (getContractFunctionName(firstContract) === 'getForkTime') return [forkTime]
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				if (getContractFunctionName(firstContract) === 'computeClearing') {
					return [[false, 0n, 0n, 0n], 1n, 0n, false, 1n, 1n, 0n, false, 0n, 0n, 0n]
				}
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'getOwnForkMigrationStatus') return [false, 0n, 0n, 0n, 0n]
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const details = await loadForkAuctionDetails(client, securityPoolAddress)

		expect(details.truthAuctionStartedAt).toBe(1n)
		expect(details.migrationEndsAt).toBe(forkTime + 4_838_400n)
	})

	test('loadForkAuctionDetails preserves finalized underfunded auction fields from the multicall tuple', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const finalizedClearingTick = 12n
		const syntheticThreshold = 7n * 10n ** 17n
		const underfundedWinningEth = 9n * 10n ** 18n
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(5n),
			multicall: async request => {
				const firstContract = request.contracts[0]
				if (getContractFunctionName(firstContract) === 'questionId') {
					return [questionId, zeroAddress, 1n, 3n, truthAuctionAddress, 0n, [0n, zeroAddress, 1n, 0n, 0n, 0n, 0n, 0n, false, false, 1n], 0n]
				}
				if (getContractFunctionName(firstContract) === 'getForkTime') return [0n]
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				if (getContractFunctionName(firstContract) === 'computeClearing') {
					return [[false, 99n, underfundedWinningEth, 0n], 20n * 10n ** 18n, 13n * 10n ** 18n, true, 12n * 10n ** 18n, 1n * 10n ** 18n, 12n * 10n ** 18n, true, syntheticThreshold, underfundedWinningEth, finalizedClearingTick]
				}
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'getOwnForkMigrationStatus') return [false, 0n, 0n, 0n, 0n]
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const details = await loadForkAuctionDetails(client, securityPoolAddress)
		if (details.truthAuction === undefined) throw new Error('Expected truth auction details to load.')

		expect(details.truthAuction.finalized).toBe(true)
		expect(details.truthAuction.underfunded).toBe(true)
		expect(details.truthAuction.clearingTick).toBe(finalizedClearingTick)
		expect(details.truthAuction.clearingPrice).toBe(syntheticThreshold)
		expect(details.truthAuction.underfundedThreshold).toBe(syntheticThreshold)
		expect(details.truthAuction.underfundedWinningEth).toBe(underfundedWinningEth)
	})

	test('loadForkAuctionDetails hides the synthetic clearing price when a finalized underfunded auction has no winning prefix', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const noWinningPrefixThreshold = 2n * 10n ** 18n
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(5n),
			multicall: async request => {
				const firstContract = request.contracts[0]
				if (getContractFunctionName(firstContract) === 'questionId') {
					return [questionId, zeroAddress, 1n, 3n, truthAuctionAddress, 0n, [0n, zeroAddress, 1n, 0n, 0n, 0n, 0n, 0n, false, false, 1n], 0n]
				}
				if (getContractFunctionName(firstContract) === 'getForkTime') return [0n]
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				if (getContractFunctionName(firstContract) === 'computeClearing') {
					return [[false, 0n, 0n, 0n], 20n * 10n ** 18n, 0n, true, 12n * 10n ** 18n, 1n * 10n ** 18n, 0n, true, noWinningPrefixThreshold, 0n, 0n]
				}
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'getOwnForkMigrationStatus') return [false, 0n, 0n, 0n, 0n]
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const details = await loadForkAuctionDetails(client, securityPoolAddress)
		if (details.truthAuction === undefined) throw new Error('Expected truth auction details to load.')

		expect(details.truthAuction.finalized).toBe(true)
		expect(details.truthAuction.underfunded).toBe(true)
		expect(details.truthAuction.clearingTick).toBe(0n)
		expect(details.truthAuction.clearingPrice).toBeUndefined()
		expect(details.truthAuction.underfundedThreshold).toBe(noWinningPrefixThreshold)
		expect(details.truthAuction.underfundedWinningEth).toBe(0n)
	})

	test('loadForkAuctionDetails surfaces own-fork migration diagnostics only for own-fork pools', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(5n),
			multicall: async request => {
				const firstContract = request.contracts[0]
				if (getContractFunctionName(firstContract) === 'questionId') {
					return [questionId, securityPoolAddress, 1n, 0n, zeroAddress, 0n, [30n, zeroAddress, 0n, 0n, 0n, 0n, 0n, 0n, true, false, 1n], 4n]
				}
				if (getContractFunctionName(firstContract) === 'getForkTime') return [0n]
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				if (request.functionName === 'getOwnForkMigrationStatus') return [true, 30n, 12n, 9n, 18n]
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const details = await loadForkAuctionDetails(client, securityPoolAddress)

		expect(details.auctionableRepAtFork).toBe(30n)
		expect(details.ownForkRepBuckets).toEqual({
			vaultRepAtFork: 12n,
			escalationChildRepPerSelectedOutcome: 9n,
			escrowSourceRepAtFork: 18n,
		})
	})
})
