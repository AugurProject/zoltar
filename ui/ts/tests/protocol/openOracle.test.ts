/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, getAddress, toHex, zeroAddress, type Address, type Hex, type TransactionReceipt } from '@zoltar/shared/ethereum'
import { encodeOpenOracleStatePreimagePacked, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SUBMITTED_TOPIC, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'
import { finalizeCoordinatorPriceCandidate, getOpenOracleAddress, loadOpenOracleReportDetails, loadOpenOracleWithdrawableBalances, loadOracleManagerDetails, loadOpenOracleReportSummaries, settleOracleReport, withdrawOpenOracleBalance } from '../../protocol/index.js'
import { peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, peripherals_openOracle_OpenOracle_OpenOracle } from '../../contractArtifact.js'
import { MAINNET_WETH_ADDRESS } from '../../lib/networkProfile.js'
import { asWriteClient, createBlockWithTimestamp, createMockLoaderClient, createMockWriteClient, getContractFunctionName, mockTransactionHash } from './testSupport.js'

const vaultAddress = getAddress('0x00000000000000000000000000000000000000c1')
const alternateSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000a2')
const token1Address = getAddress('0x00000000000000000000000000000000000000d1')
const token2Address = getAddress('0x00000000000000000000000000000000000000d2')
const wethAddress = getAddress(MAINNET_WETH_ADDRESS)
const initialReporter = getAddress('0x00000000000000000000000000000000000000e1')
const coordinatorAddress = getAddress('0x00000000000000000000000000000000000000c2')

function createPriceCandidateFinalizedLog(accepted: boolean): TransactionReceipt['logs'][number] {
	const rejectionReason = accepted ? '' : 'Insufficient dispute economics'
	return {
		address: coordinatorAddress,
		blockHash: toHex(1n, { size: 32 }),
		blockNumber: 1n,
		data: encodeAbiParameters(
			[
				{ name: 'accepted', type: 'bool' },
				{ name: 'availableCorrectionProfitWeth', type: 'uint256' },
				{ name: 'requiredCorrectionProfitWeth', type: 'uint256' },
				{ name: 'rejectionReason', type: 'string' },
			],
			[accepted, 10n, 5n, rejectionReason],
		),
		logIndex: 0n,
		removed: false,
		topics: encodeEventTopics({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, args: [7n], eventName: 'PriceCandidateFinalized' }).filter((topic): topic is Hex => topic !== null),
		transactionHash: mockTransactionHash,
		transactionIndex: 0n,
	}
}

function createOpenOraclePreimage(reportId = 1n): OpenOracleStatePreimage {
	return {
		game: {
			callbackContract: zeroAddress,
			callbackGasLimit: 0n,
			currentAmount1: 100n,
			currentAmount2: 10n,
			currentReporter: initialReporter,
			disputeDelay: 0n,
			escalationHalt: 0n,
			feePercentage: 0n,
			flags: OPEN_ORACLE_FLAG_TIME_TYPE,
			lastReportOppoTime: 1n,
			multiplier: 100n,
			numReports: 1n,
			protocolFee: 0n,
			protocolFeeRecipient: zeroAddress,
			reportTimestamp: 1n,
			settlementTime: 10n,
			settlementTimestamp: 0n,
			settlerReward: 0n,
			token1: token1Address,
			token2: token2Address,
		},
		helper: { blockNumber: 1n, blockTimestamp: 1n, creator: initialReporter, reportId },
	}
}

function createOpenOracleStateLog(preimage: OpenOracleStatePreimage, topic = OPEN_ORACLE_REPORT_SUBMITTED_TOPIC, logIndex = 0n) {
	return {
		address: getOpenOracleAddress(),
		blockNumber: 1n,
		data: encodeOpenOracleStatePreimagePacked(preimage),
		logIndex,
		removed: false,
		topics: [topic, toHex(preimage.helper.reportId, { size: 32 })],
		transactionIndex: 0n,
	}
}

describe('openOracle protocol client', () => {
	test.each([true, false])('returns the accepted=%s outcome emitted by price candidate finalization', async accepted => {
		const writeClient = createMockWriteClient(() => undefined, undefined, [createPriceCandidateFinalizedLog(accepted)])

		const result = await finalizeCoordinatorPriceCandidate(asWriteClient(writeClient), coordinatorAddress, [], '0x')

		expect(result).toEqual({ action: 'finalizeSettledPrice', hash: mockTransactionHash, priceCandidateAccepted: accepted, priceCandidateRejectionReason: accepted ? undefined : 'Insufficient dispute economics' })
	})

	test('loadOpenOracleReportSummaries keeps reports disputed when dispute history returns to the initial reporter', async () => {
		const initial = createOpenOraclePreimage()
		const disputed = { ...initial, game: { ...initial.game, numReports: 2n, reportTimestamp: 2n } }
		const client = createMockLoaderClient({
			getBlock: async () => ({ number: 1n, timestamp: 0n }),
			getLogs: async () => [createOpenOracleStateLog(initial), createOpenOracleStateLog(disputed, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, 1n)],
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'reportMeta') {
					return [[100n, 0n, 0n, 0n, token1Address, 0, token2Address, true, 0, 0, 0, 0]]
				}
				if (functionName === 'reportStatus') {
					return [[100n, 10n, initialReporter, 1, 0, initialReporter, 0]]
				}
				if (functionName === 'extraData') {
					return [['0x0000000000000000000000000000000000000000000000000000000000000000', zeroAddress, 2, 0, zeroAddress, false]]
				}
				if (functionName === 'decimals') return [18n, 18n]
				if (functionName === 'symbol') return ['REP', 'WETH']
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'nextReportId') return 2n
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const page = await loadOpenOracleReportSummaries(client, 0, 10)
		const [report] = page.reports
		if (report === undefined) throw new Error('Expected one open oracle report summary')

		expect(report.currentReporter).toBe(initialReporter)
		expect(report.disputeOccurred).toBe(true)
	})

	test('loadOpenOracleReportDetails rejects invalid token decimals', async () => {
		const preimage = createOpenOraclePreimage()
		const client = createMockLoaderClient({
			getBlock: async () => ({ number: 1n, timestamp: 0n }),
			getLogs: async () => [createOpenOracleStateLog(preimage)],
			multicall: async request => {
				const firstFunctionName = getContractFunctionName(request.contracts[0])
				if (firstFunctionName === 'reportMeta') {
					return [
						[100n, 0n, 0n, 0n, token1Address, 0, token2Address, true, 0, 0, 0, 0],
						[100n, 10n, initialReporter, 1, 0, initialReporter, 0],
						['0x0000000000000000000000000000000000000000000000000000000000000000', zeroAddress, 1, 0, zeroAddress, false],
					]
				}
				if (firstFunctionName === 'decimals') return [256n, 18n, 'REP', 'TOK']
				throw new Error(`Unexpected multicall contract: ${firstFunctionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'oracleGame') return hashOpenOracleStatePreimage(preimage)
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		await expect(loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)).rejects.toThrow(`Token metadata for ${token1Address} returned invalid decimals`)
	})

	test('loadOpenOracleReportSummaries rejects empty token symbols', async () => {
		const preimage = createOpenOraclePreimage()
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			getLogs: async () => [createOpenOracleStateLog(preimage)],
			multicall: async request => {
				const firstFunctionName = getContractFunctionName(request.contracts[0])
				if (firstFunctionName === 'reportMeta') return [[100n, 0n, 0n, 0n, token1Address, 0, token2Address, true, 0, 0, 0, 0]]
				if (firstFunctionName === 'reportStatus') return [[100n, 10n, initialReporter, 1, 0, initialReporter, 0]]
				if (firstFunctionName === 'extraData') return [['0x0000000000000000000000000000000000000000000000000000000000000000', zeroAddress, 1, 0, zeroAddress, false]]
				if (firstFunctionName === 'decimals') return [18n, 18n]
				if (firstFunctionName === 'symbol') return [' ', 'TOK']
				throw new Error(`Unexpected multicall contract: ${firstFunctionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'nextReportId') return 2n
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		await expect(loadOpenOracleReportSummaries(client, 0, 10)).rejects.toThrow(`Token metadata for ${token1Address} returned an empty symbol`)
	})

	test('loadOpenOracleReportSummaries rejects mismatched configured WETH metadata', async () => {
		const preimage = createOpenOraclePreimage()
		preimage.game.token2 = wethAddress
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			getLogs: async () => [createOpenOracleStateLog(preimage)],
			multicall: async request => {
				const firstFunctionName = getContractFunctionName(request.contracts[0])
				if (firstFunctionName === 'reportMeta') return [[100n, 0n, 0n, 0n, token1Address, 0, wethAddress, true, 0, 0, 0, 0]]
				if (firstFunctionName === 'reportStatus') return [[100n, 10n, initialReporter, 1, 0, initialReporter, 0]]
				if (firstFunctionName === 'extraData') return [['0x0000000000000000000000000000000000000000000000000000000000000000', zeroAddress, 1, 0, zeroAddress, false]]
				if (firstFunctionName === 'decimals') return [18n, 18n]
				if (firstFunctionName === 'symbol') return ['REP', 'ETH']
				throw new Error(`Unexpected multicall contract: ${firstFunctionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'nextReportId') return 2n
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		await expect(loadOpenOracleReportSummaries(client, 0, 10)).rejects.toThrow(`WETH metadata is invalid for ${wethAddress}`)
	})

	test('loadOracleManagerDetails caps active staged operation previews and preserves the pending slot outside the preview window', async () => {
		const managerAddress = getAddress('0x00000000000000000000000000000000000000d4')
		const pendingOperationSlotId = 12n
		const previewOperationIds = Array.from({ length: 25 }, (_, index) => 40n - BigInt(index))
		let capturedActiveOperationArgs: readonly [bigint, bigint] | undefined
		const requestedFunctionNames: string[] = []
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				for (const contract of request.contracts) {
					requestedFunctionNames.push(getContractFunctionName(contract))
				}
				return [1n, pendingOperationSlotId, [pendingOperationSlotId, 13n], 4n, 0n, 0n, 1n, 5n, true, 10n, 40n]
			},
			readContract: async request => {
				if (request.functionName === 'getActiveStagedOperations') {
					const args = request.args
					if (args === undefined) throw new Error('Expected getActiveStagedOperations args')
					const startIndex = args[0]
					const count = args[1]
					if (typeof startIndex !== 'bigint' || typeof count !== 'bigint') throw new Error('Expected bigint staged operation args')
					capturedActiveOperationArgs = [startIndex, count]
					return [
						previewOperationIds,
						previewOperationIds.map(operationId => ({
							amount: operationId,
							initiatorVault: vaultAddress,
							operation: 1,
							queuedAt: 0n,
							snapshotDenominator: 0n,
							snapshotTargetAllowance: 0n,
							snapshotTargetOwnership: 0n,
							snapshotTotalRep: 0n,
							targetVault: vaultAddress,
							validForSeconds: 60n,
						})),
					]
				}
				if (request.functionName === 'getPendingOperationSlot') {
					return {
						amount: 999n,
						initiatorVault: vaultAddress,
						operation: 0,
						queuedAt: 0n,
						snapshotDenominator: 0n,
						snapshotTargetAllowance: 0n,
						snapshotTargetOwnership: 0n,
						snapshotTotalRep: 0n,
						targetVault: alternateSecurityPoolAddress,
						validForSeconds: 60n,
					}
				}
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const details = await loadOracleManagerDetails(client, managerAddress)

		expect(requestedFunctionNames).toEqual([
			'lastPrice',
			'pendingOperationSlotId',
			'getPendingSettlementOperationIds',
			'MAX_PENDING_SETTLEMENT_OPERATIONS',
			'pendingReportId',
			'candidateReportId',
			'getQueuedOperationEthCost',
			'getRequestPriceEthCost',
			'isPriceUsable',
			'lastSettlementTimestamp',
			'getActiveStagedOperationCount',
		])
		expect(capturedActiveOperationArgs).toEqual([0n, 25n])
		expect(details.activeStagedOperationCount).toBe(40n)
		expect(details.pendingOperation?.operationId).toBe(pendingOperationSlotId)
		expect(details.pendingSettlementOperationIds).toEqual([pendingOperationSlotId, 13n])
		expect(details.stagedOperations?.[0]?.operationId).toBe(40n)
		expect(details.stagedOperations?.at(-1)?.operationId).toBe(pendingOperationSlotId)
		expect(details.stagedOperations).toHaveLength(26)
	})

	test('settleOracleReport sends settle with an explicit gas limit', async () => {
		const reporter = getAddress('0x00000000000000000000000000000000000000e1')
		let capturedData: Hex | undefined
		let capturedGas: bigint | undefined
		let capturedTo: Address | null | undefined
		const client = createMockWriteClient(request => {
			capturedData = request.data
			capturedGas = request.gas
			capturedTo = request.to
		})

		await settleOracleReport(client, getOpenOracleAddress(), 7n, {
			game: {
				callbackContract: zeroAddress,
				callbackGasLimit: 0n,
				currentAmount1: 1n,
				currentAmount2: 2n,
				currentReporter: reporter,
				disputeDelay: 0n,
				escalationHalt: 0n,
				feePercentage: 0n,
				flags: 0n,
				lastReportOppoTime: 1n,
				multiplier: 100n,
				numReports: 1n,
				protocolFee: 0n,
				protocolFeeRecipient: zeroAddress,
				reportTimestamp: 1n,
				settlementTime: 1n,
				settlementTimestamp: 0n,
				settlerReward: 0n,
				token1: token1Address,
				token2: token2Address,
			},
			helper: { blockNumber: 1n, blockTimestamp: 1n, creator: reporter, reportId: 7n },
		})

		expect(capturedTo).toBe(getOpenOracleAddress())
		expect(capturedGas).toBe(5_000_000n)
		expect(capturedData).toBeDefined()
		const decodedCall = decodeFunctionData({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			data: capturedData ?? ('0x' satisfies Hex),
		})
		expect(decodedCall.functionName).toBe('settle')
		expect(decodedCall.args?.[0]).toBe(7n)
	})

	test('loads sentinel-adjusted balances and keeps a failed withdrawal retryable', async () => {
		const holder = getAddress('0x00000000000000000000000000000000000000f1')
		const requestedTokens: Address[] = []
		const readClient = createMockLoaderClient({
			getBlock: async () => ({ timestamp: 0n }),
			multicall: async () => [],
			readContract: async request => {
				if (request.functionName !== 'tokenHolder') throw new Error(`Unexpected read ${request.functionName}`)
				const token = request.args?.[1]
				if (typeof token !== 'string') throw new Error('Expected tokenHolder token')
				requestedTokens.push(getAddress(token))
				if (token === zeroAddress) return 6n
				if (token === token1Address) return 8n
				if (token === token2Address) return 10n
				throw new Error(`Unexpected token ${token}`)
			},
		})

		await expect(loadOpenOracleWithdrawableBalances(readClient, getOpenOracleAddress(), holder, token1Address, token2Address)).resolves.toEqual({
			eth: 5n,
			token1: 7n,
			token2: 9n,
		})
		expect(requestedTokens).toEqual([zeroAddress, token1Address, token2Address])

		let withdrawalAttempts = 0
		const writeClient = createMockWriteClient(request => {
			withdrawalAttempts += 1
			if (withdrawalAttempts === 1) throw new Error('wallet rejected withdrawal')
			const data = request.data
			if (data === undefined) throw new Error('Expected withdrawal calldata')
			const decodedCall = decodeFunctionData({ abi: peripherals_openOracle_OpenOracle_OpenOracle.abi, data })
			expect(decodedCall.functionName).toBe('withdrawTo')
			expect(decodedCall.args).toEqual([token1Address, 2n ** 256n - 1n, holder])
		})

		await expect(withdrawOpenOracleBalance(writeClient, getOpenOracleAddress(), token1Address, holder)).rejects.toThrow('wallet rejected withdrawal')
		await expect(withdrawOpenOracleBalance(writeClient, getOpenOracleAddress(), token1Address, holder)).resolves.toMatchObject({ action: 'withdrawBalance' })
		expect(withdrawalAttempts).toBe(2)
	})
})
