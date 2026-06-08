/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, getAddress, zeroAddress, type Address, type Hash, type Hex } from 'viem'
import { getOpenOracleAddress, loadAllSecurityPools, loadEscalationDeposits, loadForkAuctionDetails, loadTruthAuctionActiveTickPage, loadTruthAuctionBidderBidPage, loadTruthAuctionTickBidPage, loadTruthAuctionTickPage, loadTruthAuctionTickSummary, migrateSharesFromUniverse, settleOracleReport } from '../contracts.js'
import { getForkOutcomeKey } from '../contracts/helpers.js'
import { peripherals_openOracle_OpenOracle_OpenOracle, peripherals_tokens_ShareToken_ShareToken } from '../contractArtifact.js'
import type { ReadClient } from '../types/contracts.js'

const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
const alternateSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000a2')
const shareTokenAddress = getAddress('0x00000000000000000000000000000000000000b2')
const vaultAddress = getAddress('0x00000000000000000000000000000000000000c1')
const truthAuctionAddress = getAddress('0x00000000000000000000000000000000000000f6')
const transactionHash = '0x00000000000000000000000000000000000000000000000000000000000000c3' satisfies Hash

type MockWriteClient = Parameters<typeof migrateSharesFromUniverse>[0]
type MockReadClient = Parameters<typeof loadEscalationDeposits>[0]
type MockLoaderClient = Parameters<typeof loadAllSecurityPools>[0]
type MockReadContractRequest = Parameters<MockReadClient['readContract']>[0]
type MockReadContractHandler = (request: MockReadContractRequest) => Promise<unknown>
type MockLoaderMulticallRequest = Parameters<MockLoaderClient['multicall']>[0]
type MockLoaderMulticallHandler = (request: MockLoaderMulticallRequest) => Promise<unknown>

function getContractFunctionName(contract: unknown) {
	if (typeof contract !== 'object' || contract === null || !('functionName' in contract)) throw new Error('Unexpected multicall contract')
	const functionName = contract.functionName
	if (typeof functionName !== 'string') throw new Error('Unexpected multicall contract')
	return functionName
}

function createBlockWithTimestamp(timestamp: bigint) {
	return { timestamp }
}

function createReadContractStub(handler: MockReadContractHandler): ReadClient['readContract'] {
	return async request => (await handler(request as MockReadContractRequest)) as never
}

function createMulticallStub(handler: MockLoaderMulticallHandler): MockLoaderClient['multicall'] {
	return async request => (await handler(request as MockLoaderMulticallRequest)) as never
}

function createMockWriteClient(onSendTransaction: (request: { data?: Hex | undefined; gas?: bigint | undefined; to?: Address | null | undefined }) => void): MockWriteClient {
	const readContract = createReadContractStub(async request => {
		if (request.functionName === 'universeId') return 12n
		if (request.functionName === 'shareToken') return shareTokenAddress
		throw new Error(`Unexpected readContract function: ${request.functionName}`)
	})

	return {
		readContract,
		sendTransaction: async request => {
			onSendTransaction(request)
			return transactionHash
		},
		waitForTransactionReceipt: async () => ({ status: 'success' }),
	} satisfies MockWriteClient
}

function createMockReadClient(readContract: MockReadContractHandler): MockReadClient {
	return {
		readContract: createReadContractStub(readContract),
	}
}

function createMockLoaderClient({ getBlock, multicall, readContract }: { getBlock: () => Promise<{ timestamp: bigint }>; multicall: MockLoaderMulticallHandler; readContract: MockReadContractHandler }): MockLoaderClient {
	return {
		getBlock,
		multicall: createMulticallStub(multicall),
		readContract: createReadContractStub(readContract),
	} as unknown as MockLoaderClient
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

	test('getForkOutcomeKey treats the default root-pool fork outcome as none', () => {
		expect(getForkOutcomeKey(0n, getAddress('0x0000000000000000000000000000000000000000'))).toBe('none')
		expect(getForkOutcomeKey(0n, securityPoolAddress)).toBe('invalid')
		expect(getForkOutcomeKey(1n, securityPoolAddress)).toBe('yes')
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
					return [questionId, zeroAddress, 1n, 0n, zeroAddress, 0n, [0n, zeroAddress, 0n, 0n, 0n, false, 0], 3n]
				}
				if (getContractFunctionName(firstContract) === 'getForkTime') return [0n]
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const details = await loadForkAuctionDetails(client, securityPoolAddress)

		expect(details.parentSecurityPoolAddress).toBe(zeroAddress)
		expect(details.forkOutcome).toBe('none')
		expect(details.hasForkActivity).toBe(false)
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
					return [questionId, truthAuctionAddress, 1n, 0n, zeroAddress, 0n, [0n, zeroAddress, 1n, 0n, 0n, false, 1], 4n]
				}
				if (getContractFunctionName(firstContract) === 'getForkTime') return [forkTime]
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				if (getContractFunctionName(firstContract) === 'computeClearing') {
					return [[0n, 0n, 0n], 1n, 0n, false, 1n, 1n, 0n, false]
				}
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const details = await loadForkAuctionDetails(client, securityPoolAddress)

		expect(details.truthAuctionStartedAt).toBe(1n)
		expect(details.migrationEndsAt).toBe(forkTime + 4_838_400n)
	})

	test('loadAllSecurityPools keeps the default root-pool fork outcome unset and inactive', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				if (getContractFunctionName(firstContract) === 'completeSetCollateralAmount') {
					return [0n, 10n, [0n, zeroAddress, 0n, 0n, 0n, false, 0], 0n, 0n, 3n, 0n, 0n, 0n, 0n]
				}
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 1n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							completeSetCollateralAmount: 0n,
							currentRetentionRate: 0n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							securityMultiplier: 2n,
							securityPool: securityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
					]
				}
				if (request.functionName === 'getVaultCount') return 0n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const pools = await loadAllSecurityPools(client)
		const [pool] = pools
		if (pool === undefined) throw new Error('Expected one security pool')

		expect(pool.parent).toBe(zeroAddress)
		expect(pool.forkOutcome).toBe('none')
		expect(pool.hasForkActivity).toBe(false)
	})

	test('loadAllSecurityPools defers vault detail loading for unselected pools in selected mode', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const getVaultCalls: Address[] = []
		const securityVaultCalls: Address[] = []
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				if (getContractFunctionName(firstContract) === 'completeSetCollateralAmount') {
					return [0n, 10n, [0n, zeroAddress, 0n, 0n, 0n, false, 0], 0n, 0n, 3n, 0n, 5n, 0n, 0n]
				}
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				if (getContractFunctionName(firstContract) === 'securityVaults') {
					const address = Reflect.get(firstContract, 'address')
					if (typeof address !== 'string') throw new Error('Expected vault security pool address')
					securityVaultCalls.push(getAddress(address))
					return [[1n, 3n, 0n, 0n, 0n]]
				}
				if (getContractFunctionName(firstContract) === 'poolOwnershipToRep') return [5n]
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 2n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							completeSetCollateralAmount: 0n,
							currentRetentionRate: 0n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							securityMultiplier: 2n,
							securityPool: securityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
						{
							completeSetCollateralAmount: 0n,
							currentRetentionRate: 0n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							securityMultiplier: 2n,
							securityPool: alternateSecurityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 2n,
						},
					]
				}
				if (request.functionName === 'getVaultCount') {
					const address = Reflect.get(request, 'address')
					if (typeof address !== 'string') throw new Error('Expected security pool address')
					return getAddress(address) === securityPoolAddress ? 1n : 2n
				}
				if (request.functionName === 'getVaults') {
					const address = Reflect.get(request, 'address')
					if (typeof address !== 'string') throw new Error('Expected security pool address')
					const normalizedAddress = getAddress(address)
					getVaultCalls.push(normalizedAddress)
					if (normalizedAddress === alternateSecurityPoolAddress) throw new Error('Unexpected vault load for unselected pool')
					return [vaultAddress]
				}
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const pools = await loadAllSecurityPools(client, {
			selectedSecurityPoolAddress: securityPoolAddress,
			vaultDetailMode: 'selected',
		})

		const selectedPool = pools.find(pool => pool.securityPoolAddress === securityPoolAddress)
		const deferredPool = pools.find(pool => pool.securityPoolAddress === alternateSecurityPoolAddress)
		if (selectedPool === undefined || deferredPool === undefined) throw new Error('Expected both security pools')

		expect(getVaultCalls).toEqual([securityPoolAddress])
		expect(securityVaultCalls).toEqual([securityPoolAddress])
		expect(selectedPool.hasLoadedVaults).toBe(true)
		expect(selectedPool.vaults).toHaveLength(1)
		expect(selectedPool.totalRepDeposit).toBe(5n)
		expect(deferredPool.hasLoadedVaults).toBe(false)
		expect(deferredPool.vaults).toEqual([])
		expect(deferredPool.vaultCount).toBe(2n)
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
		const readContract: MockReadContractHandler = async request => {
			const args = Reflect.get(request, 'args')
			const startIndex = Array.isArray(args) ? args[1] : undefined
			if (typeof startIndex !== 'bigint') throw new Error('Expected pagination start index')
			readCalls.push(startIndex)
			if (startIndex === 0n) return firstPage
			if (startIndex === 30n) return secondPage
			throw new Error(`Unexpected start index: ${startIndex.toString()}`)
		}
		const client = createMockReadClient(async request => {
			return await readContract(request)
		})

		const deposits = await loadEscalationDeposits(client, escalationGameAddress, 'yes')

		expect(readCalls).toEqual([0n, 30n])
		expect(deposits).toHaveLength(30)
		expect(deposits.some(deposit => deposit.amount === 0n)).toBe(false)
		expect(deposits[28]?.depositIndex).toBe(28n)
		expect(deposits[29]?.depositIndex).toBe(30n)
	})

	test('truth auction page loaders validate page inputs before reading', async () => {
		const client = createMockReadClient(async () => {
			throw new Error('readContract should not be called for invalid pagination')
		})

		await expect(loadTruthAuctionTickPage(client, truthAuctionAddress, -1, 10)).rejects.toThrow('Page index must be a non-negative integer')
		await expect(loadTruthAuctionActiveTickPage(client, truthAuctionAddress, -1, 10)).rejects.toThrow('Page index must be a non-negative integer')
		await expect(loadTruthAuctionTickPage(client, truthAuctionAddress, 0, 0)).rejects.toThrow('Page size must be a positive integer')
		await expect(loadTruthAuctionTickBidPage(client, truthAuctionAddress, 1n, 0, 0)).rejects.toThrow('Page size must be a positive integer')
		await expect(loadTruthAuctionBidderBidPage(client, truthAuctionAddress, securityPoolAddress, -1, 10)).rejects.toThrow('Page index must be a non-negative integer')
	})

	test('truth auction page loaders allow large requested page sizes', async () => {
		const readCalls: Array<{ functionName: string; args: unknown[] | undefined }> = []
		const client = createMockReadClient(async request => {
			readCalls.push({
				functionName: String(request.functionName),
				args: Array.isArray(request.args) ? [...request.args] : undefined,
			})
			if (request.functionName === 'getTickCount') return 1n
			if (request.functionName === 'getTickPage') return []
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		await expect(loadTruthAuctionTickPage(client, truthAuctionAddress, 0, 500)).resolves.toEqual({
			pageIndex: 0,
			pageSize: 500,
			tickCount: 1n,
			ticks: [],
		})
		expect(readCalls).toEqual([
			{ functionName: 'getTickCount', args: [] },
			{ functionName: 'getTickPage', args: [0n, 500n] },
		])
	})

	test('loadTruthAuctionTickPage maps tuple responses and converts page indexes to offsets', async () => {
		const readCalls: Array<{ functionName: string; args: unknown[] | undefined }> = []
		const client = createMockReadClient(async request => {
			readCalls.push({
				functionName: String(request.functionName),
				args: Array.isArray(request.args) ? [...request.args] : undefined,
			})
			if (request.functionName === 'getTickCount') return 3n
			if (request.functionName === 'getTickPage')
				return [
					{ tick: 1n, price: 2n, currentTotalEth: 3n, submissionCount: 4n, active: true },
					{ tick: 5n, price: 6n, currentTotalEth: 7n, submissionCount: 8n, active: false },
				]
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		const page = await loadTruthAuctionTickPage(client, truthAuctionAddress, 2, 5)

		expect(readCalls).toEqual([
			{ functionName: 'getTickCount', args: [] },
			{ functionName: 'getTickPage', args: [10n, 5n] },
		])
		expect(page).toEqual({
			pageIndex: 2,
			pageSize: 5,
			tickCount: 3n,
			ticks: [
				{ tick: 1n, price: 2n, currentTotalEth: 3n, submissionCount: 4n, active: true },
				{ tick: 5n, price: 6n, currentTotalEth: 7n, submissionCount: 8n, active: false },
			],
		})
	})

	test('loadTruthAuctionTickSummary maps a direct tick summary read', async () => {
		const client = createMockReadClient(async request => {
			if (request.functionName === 'getTickSummary') return { tick: 9n, price: 10n, currentTotalEth: 11n, submissionCount: 12n, active: false }
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		await expect(loadTruthAuctionTickSummary(client, truthAuctionAddress, 9n)).resolves.toEqual({
			tick: 9n,
			price: 10n,
			currentTotalEth: 11n,
			submissionCount: 12n,
			active: false,
		})
	})

	test('loadTruthAuctionActiveTickPage maps active ladder pages and converts page indexes to offsets', async () => {
		const readCalls: Array<{ functionName: string; args: unknown[] | undefined }> = []
		const client = createMockReadClient(async request => {
			readCalls.push({
				functionName: String(request.functionName),
				args: Array.isArray(request.args) ? [...request.args] : undefined,
			})
			if (request.functionName === 'activeTickCount') return 4n
			if (request.functionName === 'getActiveTickPage')
				return [
					{ tick: 12n, price: 7n, currentTotalEth: 6n, submissionCount: 2n, active: true },
					{ tick: 10n, price: 5n, currentTotalEth: 4n, submissionCount: 1n, active: true },
				]
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		const page = await loadTruthAuctionActiveTickPage(client, truthAuctionAddress, 1, 2)

		expect(readCalls).toEqual([
			{ functionName: 'activeTickCount', args: [] },
			{ functionName: 'getActiveTickPage', args: [2n, 2n] },
		])
		expect(page).toEqual({
			pageIndex: 1,
			pageSize: 2,
			tickCount: 4n,
			ticks: [
				{ tick: 12n, price: 7n, currentTotalEth: 6n, submissionCount: 2n, active: true },
				{ tick: 10n, price: 5n, currentTotalEth: 4n, submissionCount: 1n, active: true },
			],
		})
	})

	test('loadTruthAuctionTickBidPage maps per-tick bid tuples and preserves empty pages', async () => {
		const readCalls: Array<{ functionName: string; args: unknown[] | undefined }> = []
		const client = createMockReadClient(async request => {
			readCalls.push({
				functionName: String(request.functionName),
				args: Array.isArray(request.args) ? [...request.args] : undefined,
			})
			if (request.functionName === 'getBidCountAtTick') return 2n
			if (request.functionName === 'getBidPageAtTick') return []
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		const page = await loadTruthAuctionTickBidPage(client, truthAuctionAddress, 11n, 1, 10)

		expect(readCalls).toEqual([
			{ functionName: 'getBidCountAtTick', args: [11n] },
			{ functionName: 'getBidPageAtTick', args: [11n, 10n, 10n] },
		])
		expect(page).toEqual({
			tick: 11n,
			pageIndex: 1,
			pageSize: 10,
			bidCount: 2n,
			bids: [],
		})
	})

	test('loadTruthAuctionBidderBidPage maps bidder bid tuples and converts bidder pages to offsets', async () => {
		const readCalls: Array<{ functionName: string; args: unknown[] | undefined }> = []
		const bidder = getAddress('0x00000000000000000000000000000000000000a7')
		const client = createMockReadClient(async request => {
			readCalls.push({
				functionName: String(request.functionName),
				args: Array.isArray(request.args) ? [...request.args] : undefined,
			})
			if (request.functionName === 'getBidderBidCount') return 4n
			if (request.functionName === 'getBidderBidPage')
				return [
					{ tick: 10n, bidIndex: 0n, bidder, ethAmount: 3n, cumulativeEth: 3n, activeCumulativeEthBeforeBid: 0n, claimed: false, refunded: false },
					{ tick: 11n, bidIndex: 1n, bidder, ethAmount: 5n, cumulativeEth: 8n, activeCumulativeEthBeforeBid: 3n, claimed: true, refunded: true },
				]
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		const page = await loadTruthAuctionBidderBidPage(client, truthAuctionAddress, bidder, 1, 2)

		expect(readCalls).toEqual([
			{ functionName: 'getBidderBidCount', args: [bidder] },
			{ functionName: 'getBidderBidPage', args: [bidder, 2n, 2n] },
		])
		expect(page).toEqual({
			bidder,
			pageIndex: 1,
			pageSize: 2,
			bidCount: 4n,
			bids: [
				{ tick: 10n, bidIndex: 0n, bidder, ethAmount: 3n, cumulativeEth: 3n, activeCumulativeEthBeforeBid: 0n, claimed: false, refunded: false },
				{ tick: 11n, bidIndex: 1n, bidder, ethAmount: 5n, cumulativeEth: 8n, activeCumulativeEthBeforeBid: 3n, claimed: true, refunded: true },
			],
		})
	})
})
