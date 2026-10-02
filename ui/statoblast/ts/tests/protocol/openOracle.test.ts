import { registerTransactionPreparationScope } from '@zoltar/ui-core-shared/transactions/transactionReviewScope.js'
import { transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createWalletClient, custom, publicActions, encodeAbiParameters, encodeEventTopics, parseAbiParameters, decodeFunctionData, getAddress, toHex, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getOpenOracleGameTuple, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_TRACK_DISPUTES, OPEN_ORACLE_FLAG_TIME_TYPE, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { createOpenOracleReportInstance, disputeOracleReport, loadOpenOracleReportDetails, loadOpenOracleWithdrawableBalances, loadOpenOracleReportSummaries, settleOracleReport, withdrawOpenOracleBalance } from '@zoltar/ui-statoblast-shared/protocol/openOracle.js'
import { getOracleManagerPriceValidUntilTimestamp } from '@zoltar/ui-statoblast-shared/protocol/oracleTiming.js'
import { loadOracleManagerDetails } from '@zoltar/ui-statoblast-shared/protocol/oracleCoordinator.js'
import { getOpenOracleAddress } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { loadLiquidationApproval, type LiquidationApprovalParams } from '@zoltar/ui-statoblast-shared/protocol/liquidationApprovals.js'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_openOracle_OpenOracle_OpenOracle } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { asWriteClient, createMulticallStub, createBlockWithTimestamp, createMockLoaderClient, createMockWriteClient, getContractFunctionName } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { createReviewedClient } from '@zoltar/ui-statoblast-shared/protocol/reviewedClient.js'
import { getOpenOracleDisputeSwapTokenKey } from '@zoltar/ui-statoblast-shared/protocol/openOracleMath.js'

const vaultAddress = getAddress('0x00000000000000000000000000000000000000c1')
const alternateSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000a2')
const token1Address = getAddress('0x00000000000000000000000000000000000000d1')
const token2Address = getAddress('0x00000000000000000000000000000000000000d2')
const wethAddress = getAddress(SEPOLIA_NETWORK_PROFILE.wethAddress)
const initialReporter = getAddress('0x00000000000000000000000000000000000000e1')

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
			flags: OPEN_ORACLE_FLAG_TIME_TYPE | OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES,
			lastReportOppoTime: 1n,
			multiplier: 100n,
			numReports: 1n,
			protocolFee: 0n,
			protocolFeeRecipient: zeroAddress,
			reportTimestamp: 1n,
			settlementTime: 10n,
			settlementTimestamp: 0n,
			settlerRewardAttoEth: 0n,
			token1: token1Address,
			token2: token2Address,
		},
		helper: { blockNumber: 1n, blockTimestamp: 1n, creator: initialReporter, reportId },
	}
}

function readStoredOracleFixture(functionName: string, preimage: OpenOracleStatePreimage) {
	switch (functionName) {
		case 'storedGame':
			return getOpenOracleGameTuple(preimage.game)
		case 'storedHelper':
			return [preimage.helper.creator, preimage.helper.blockTimestamp, preimage.helper.blockNumber]
		case 'disputeHistory':
			return [100n, 10n, 0n, 1n]
		case 'oracleGame':
			return hashOpenOracleStatePreimage(preimage)
		default:
			throw new Error(`Unexpected read: ${functionName}`)
	}
}

describe('openOracle protocol client', () => {
	for (const timeType of [true, false]) {
		for (const remaining of [0n, 1n, timeType ? 60n : 2n, timeType ? 61n : 3n]) {
			test(`dispute checks ${remaining} remaining ${timeType ? 'seconds' : 'blocks'} before sending`, async () => {
				const preimage = createOpenOraclePreimage()
				preimage.game.reportTimestamp = 100n
				preimage.game.settlementTime = 1_000n
				if (!timeType) preimage.game.flags &= ~OPEN_ORACLE_FLAG_TIME_TYPE
				let sent = 0
				const writer = createMockWriteClient(
					() => sent++,
					async request => readStoredOracleFixture(request.functionName, preimage),
				)
				const reader = createMockLoaderClient({ getBlock: async () => ({ timestamp: timeType ? 1_100n - remaining : 1n, number: timeType ? 1n : 1_100n - remaining }), multicall: async () => [], readContract: async request => readStoredOracleFixture(request.functionName, preimage) })
				const wallet = createWalletClient({
					account: initialReporter,
					chain: SEPOLIA_NETWORK_PROFILE.chain,
					transport: custom({
						request: async () => {
							throw new Error('Unexpected RPC')
						},
					}),
				}).extend(publicActions)
				const attempt = disputeOracleReport({ ...wallet, ...asWriteClient(writer), ...reader, account: wallet.account }, getOpenOracleAddress(), 1n, token2Address, 101n, 11n, 10n, hashOpenOracleStatePreimage(preimage))
				if (remaining > (timeType ? 60n : 2n)) {
					await attempt
					expect(sent).toBe(1)
				} else {
					await expect(attempt).rejects.toThrow('Dispute window ends too soon')
					expect(sent).toBe(0)
				}
			})
		}
	}

	for (const timeType of [true, false]) {
		const reserve = timeType ? 60n : 2n
		for (const remaining of [1n, reserve, reserve + 1n]) {
			test(`rechecks dispute after wallet review with ${remaining} ${timeType ? 'seconds' : 'blocks'} remaining`, async () => {
				const preimage = createOpenOraclePreimage()
				preimage.game.reportTimestamp = 100n
				preimage.game.settlementTime = 1_000n
				if (!timeType) preimage.game.flags &= ~OPEN_ORACLE_FLAG_TIME_TYPE
				let currentClock = 1_000n
				let sent = 0
				let validations = 0
				const writer = createMockWriteClient(
					() => sent++,
					async request => readStoredOracleFixture(request.functionName, preimage),
				)
				const reader = createMockLoaderClient({ getBlock: async () => ({ timestamp: timeType ? currentClock : 1n, number: timeType ? 1n : currentClock }), multicall: async () => [], readContract: async request => readStoredOracleFixture(request.functionName, preimage) })
				const wallet = createWalletClient({
					account: initialReporter,
					chain: SEPOLIA_NETWORK_PROFILE.chain,
					transport: custom({
						request: async () => {
							throw new Error('Unexpected RPC')
						},
					}),
				}).extend(publicActions)
				const reviewed = createReviewedClient({ ...wallet, ...asWriteClient(writer), ...reader, account: wallet.account, call: async () => ({ data: toHex(0n) }) }, async () => {
					if (++validations === 2) currentClock = 1_100n - remaining
				})
				const attempt = disputeOracleReport(reviewed, getOpenOracleAddress(), 1n, token2Address, 101n, 11n, 10n, hashOpenOracleStatePreimage(preimage))
				if (remaining > reserve) {
					await attempt
					expect(sent).toBe(1)
				} else {
					await expect(attempt).rejects.toThrow('Dispute window ends too soon')
					expect(sent).toBe(0)
				}
				expect(validations).toBe(2)
			})
		}
	}

	test('normalizes displayed report prices for different token decimals', async () => {
		const preimage = createOpenOraclePreimage()
		preimage.game.currentAmount1 = 10n ** 18n
		preimage.game.currentAmount2 = 3000n * 10n ** 6n
		const client = createMockLoaderClient({
			getBlock: async () => ({ number: 1n, timestamp: 2n }),
			multicall: async () => [18n, 6n, 'ONE', 'TWO'],
			readContract: async request => readStoredOracleFixture(request.functionName, preimage),
		})
		const report = await loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)
		expect(report.price).toBe(3000n * 10n ** 30n)
	})

	test('exposes fee and escalation flags on loaded report details', async () => {
		const preimage = createOpenOraclePreimage()
		const client = createMockLoaderClient({
			getBlock: async () => ({ number: 1n, timestamp: 2n }),
			multicall: async () => [18n, 18n, 'ONE', 'TWO'],
			readContract: async request => readStoredOracleFixture(request.functionName, preimage),
		})
		const defaultReport = await loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)
		expect(defaultReport.feesOnlyAtHalt).toBe(false)
		expect(defaultReport.flexibleEscalation).toBe(false)
		preimage.game.flags |= (1n << 5n) | (1n << 6n)
		const flaggedReport = await loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)
		expect(flaggedReport.feesOnlyAtHalt).toBe(true)
		expect(flaggedReport.flexibleEscalation).toBe(true)
	})

	test('loads stored oracle reports with log access disabled', async () => {
		const preimage = createOpenOraclePreimage()
		preimage.game.flags |= OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES
		const client = createMockLoaderClient({
			getBlock: async () => ({ number: 1n, timestamp: 2n }),
			getLogs: async () => {
				throw new Error('Log access unavailable')
			},
			multicall: async () => [18n, 18n, 'ONE', 'TWO'],
			readContract: async request => {
				switch (request.functionName) {
					case 'storedGame':
						return getOpenOracleGameTuple(preimage.game)
					case 'storedHelper':
						return [initialReporter, 1n, 1n]
					case 'disputeHistory':
						return [100n, 10n, 0n, 1n]
					case 'oracleGame':
						return hashOpenOracleStatePreimage(preimage)
					default:
						throw new Error(`Unexpected read: ${request.functionName}`)
				}
			},
		})
		const report = await loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)
		expect(report.currentAmount1).toBe(100n)
		expect(report.initialReporter).toBe(initialReporter)
		preimage.game.numReports = 2n
		preimage.game.currentAmount1 = 200n
		preimage.game.settlementTimestamp = 2n
		const settled = await loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)
		expect(settled.isDistributed).toBe(true)
		expect(settled.numReports).toBe(2n)
		expect(settled.initialReporter).toBeUndefined()
		expect(settled.exactToken1Report).toBe(100n)
		const invalidHashClient = { ...client, readContract: createMockLoaderClient({ getBlock: client.getBlock, multicall: async () => [], readContract: async request => (request.functionName === 'oracleGame' ? `0x${'11'.repeat(32)}` : readStoredOracleFixture(request.functionName, preimage)) }).readContract }
		await expect(loadOpenOracleReportDetails(invalidHashClient, getOpenOracleAddress(), 1n)).rejects.toThrow('stored state does not match')
		preimage.game.flags = 0n
		await expect(loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)).rejects.toThrow('did not enable stored state')
	})

	test('keeps supported reports browsable alongside a report without stored state', async () => {
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(1n),
			getLogs: async () => {
				throw new Error('Log access unavailable')
			},
			multicall: async request => (getContractFunctionName(request.contracts[0]) === 'decimals' ? [18n, 18n] : ['ONE', 'TWO']),
			readContract: async request => {
				if (request.functionName === 'nextReportId') return 3n
				const reportId = request.args?.[0]
				if (typeof reportId !== 'bigint') throw new Error('Missing report id')
				const preimage = createOpenOraclePreimage(reportId)
				if (reportId === 2n) preimage.game.flags = 0n
				return readStoredOracleFixture(request.functionName, preimage)
			},
		})
		const page = await loadOpenOracleReportSummaries(client, 0, 10)
		expect(page.reportCount).toBe(2n)
		expect(page.reports.map(report => report.reportId)).toEqual([1n])
		expect(page.unavailableReports).toEqual([{ reportId: 2n, message: 'Oracle report #2 is unavailable: it did not enable stored state and dispute history' }])
	})

	test('derives the dispute contribution token from the strict proposed-price direction', () => {
		const { currentAmount1, currentAmount2 } = createOpenOraclePreimage().game
		expect(getOpenOracleDisputeSwapTokenKey({ currentAmount1, currentAmount2, newAmount1: 100n, newAmount2: 11n })).toBe('token2')
		expect(getOpenOracleDisputeSwapTokenKey({ currentAmount1, currentAmount2, newAmount1: 100n, newAmount2: 9n })).toBe('token1')
		expect(getOpenOracleDisputeSwapTokenKey({ currentAmount1, currentAmount2, newAmount1: 100n, newAmount2: 10n })).toBe('token1')
	})

	test('loadOpenOracleReportSummaries keeps reports disputed when dispute history returns to the initial reporter', async () => {
		const initial = createOpenOraclePreimage()
		initial.game.flags = OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES
		const disputed = { ...initial, game: { ...initial.game, numReports: 2n, reportTimestamp: 2n } }
		const client = createMockLoaderClient({
			getBlock: async () => ({ number: 1n, timestamp: 0n }),
			getLogs: async () => {
				throw new Error('Log access unavailable')
			},
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'decimals') return [18n, 18n]
				if (functionName === 'symbol') return ['REP', 'WETH']
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'nextReportId') return 2n
				return readStoredOracleFixture(request.functionName, disputed)
			},
		})

		const page = await loadOpenOracleReportSummaries(client, 0, 10)
		const [report] = page.reports
		if (report === undefined) throw new Error('Expected one open oracle report summary')

		expect(report.currentReporter).toBe(initialReporter)
		expect(report.disputeOccurred).toBe(true)
		expect(report.timeType).toBe(false)
	})

	test('loadOpenOracleReportDetails rejects invalid token decimals', async () => {
		const preimage = createOpenOraclePreimage()
		const client = createMockLoaderClient({
			getBlock: async () => ({ number: 1n, timestamp: 0n }),
			getLogs: async () => {
				throw new Error('Log access unavailable')
			},
			multicall: async request => {
				const firstFunctionName = getContractFunctionName(request.contracts[0])
				if (firstFunctionName === 'decimals') return [256n, 18n, 'REP', 'TOK']
				throw new Error(`Unexpected multicall contract: ${firstFunctionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'oracleGame') return hashOpenOracleStatePreimage(preimage)
				return readStoredOracleFixture(request.functionName, preimage)
			},
		})

		await expect(loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)).rejects.toThrow(`Token metadata for ${token1Address} returned invalid decimals`)
	})

	test.each([
		{ error: `Token metadata for ${token1Address} returned an empty symbol`, name: 'empty token symbols', symbols: [' ', 'TOK'], token2IsWeth: false },
		{ error: `WETH metadata is invalid for ${wethAddress}`, name: 'mismatched configured WETH metadata', symbols: ['REP', 'ETH'], token2IsWeth: true },
	])('loadOpenOracleReportSummaries rejects $name', async ({ error, symbols, token2IsWeth }) => {
		const preimage = createOpenOraclePreimage()
		if (token2IsWeth) preimage.game.token2 = wethAddress
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			getLogs: async () => {
				throw new Error('Log access unavailable')
			},
			multicall: async request => {
				const firstFunctionName = getContractFunctionName(request.contracts[0])
				if (firstFunctionName === 'decimals') return [18n, 18n]
				if (firstFunctionName === 'symbol') return symbols
				throw new Error(`Unexpected multicall contract: ${firstFunctionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'nextReportId') return 2n
				return readStoredOracleFixture(request.functionName, preimage)
			},
		})

		await expect(loadOpenOracleReportSummaries(client, 0, 10)).rejects.toThrow(error)
	})

	test('loadOracleManagerDetails caps active staged operation previews and preserves the pending slot outside the preview window', async () => {
		const managerAddress = getAddress('0x00000000000000000000000000000000000000d4')
		const pendingOperationSlotId = 12n
		const previewOperationIds = Array.from({ length: 25 }, (_, index) => 40n - BigInt(index))
		let capturedActiveOperationArgs: readonly [bigint, bigint] | undefined
		const requestedFunctionNames: string[] = []
		const client = createMockLoaderClient({
			getBlock: async () => ({ timestamp: 0n, baseFeePerGas: 0n }),
			multicall: async request => {
				for (const contract of request.contracts) {
					requestedFunctionNames.push(getContractFunctionName(contract))
				}
				return [1n, pendingOperationSlotId, [pendingOperationSlotId, 13n], 4n, 0n, 1n, true, 10n, 40n, 60n, 1_000n]
			},
			readContract: async request => {
				if (request.functionName === 'getSettlementCallbackGasLimit') return 10
				if (request.functionName === 'gasConsumedOpenOracleReportPrice') return 20n
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
							operationValue: operationId,
							operator: vaultAddress,
							operation: 1,
							queuedAt: 0n,
							snapshotTotalRepBackingUnits: 0n,
							snapshotTargetUnderwritingLimitAttoEth: 0n,
							snapshotTargetBackingUnits: 0n,
							snapshotTotalPoolHeldAttoRep: 0n,
							targetVault: vaultAddress,
							validForSeconds: 60n,
						})),
					]
				}
				if (request.functionName === 'getPendingOperationSlot') {
					return {
						operationValue: 999n,
						operator: vaultAddress,
						operation: 0,
						queuedAt: 0n,
						snapshotTotalRepBackingUnits: 0n,
						snapshotTargetUnderwritingLimitAttoEth: 0n,
						snapshotTargetBackingUnits: 0n,
						snapshotTotalPoolHeldAttoRep: 0n,
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
			'getQueuedOperationCostAttoEth',
			'isPriceValid',
			'lastSettlementTimestamp',
			'getActiveStagedOperationCount',
			'settlementTime',
			'minLiquidationPriceDistanceBps',
		])
		expect(details.minLiquidationPriceDistanceBps).toBe(1_000n)
		expect(capturedActiveOperationArgs).toEqual([0n, 25n])
		expect(details.activeStagedOperationCount).toBe(40n)
		expect(details.pendingOperation?.operationId).toBe(pendingOperationSlotId)
		expect(details.pendingSettlementOperationIds).toEqual([pendingOperationSlotId, 13n])
		expect(details.stagedOperations?.[0]?.operationId).toBe(40n)
		expect(details.stagedOperations?.at(-1)?.operationId).toBe(pendingOperationSlotId)
		expect(details.stagedOperations).toHaveLength(26)
	})

	for (const association of ['verified', 'different oracle', 'different coordinator', 'generic callback'] as const) {
		test(`report freshness is attached only to a verified pool coordinator: ${association}`, async () => {
			const preimage = createOpenOraclePreimage()
			preimage.game.callbackContract = vaultAddress
			const client = createMockLoaderClient({
				getBlock: async () => ({ number: 1n, timestamp: 12n }),
				readContract: async request => readStoredOracleFixture(request.functionName, preimage),
				multicall: async request => {
					const first = getContractFunctionName(request.contracts[0])
					if (first === 'decimals') return [18n, 18n, 'ONE', 'TWO']
					if (first === 'openOracle')
						return association === 'generic callback'
							? [
									{ status: 'failure', error: new Error('No such getter') },
									{ status: 'failure', error: new Error('No such getter') },
								]
							: [
									{ status: 'success', result: association === 'different oracle' ? token1Address : getOpenOracleAddress() },
									{ status: 'success', result: alternateSecurityPoolAddress },
								]
					if (first === 'openOraclePriceCoordinator') return [{ status: 'success', result: association === 'different coordinator' ? token1Address : vaultAddress }]
					throw new Error(`Unexpected multicall ${first}`)
				},
			})
			const report = await loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)
			if (association === 'verified') expect(report.coordinatorPriceValidUntilTimestamp).toBe(getOracleManagerPriceValidUntilTimestamp(11n))
			else expect(report.coordinatorPriceValidUntilTimestamp).toBeUndefined()
		})
	}

	for (const status of ['accepted', 'rejected'] as const) {
		test(`settlement filters unrelated logs before the ${status} coordinator outcome`, async () => {
			const preimage = createOpenOraclePreimage(7n)
			preimage.game.callbackContract = vaultAddress
			const abi = statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi
			const data = status === 'accepted' ? encodeAbiParameters(parseAbiParameters('uint256,uint256'), [123n, 11n]) : encodeAbiParameters(parseAbiParameters('string,uint256,uint256,uint256,uint256'), ['Base fee too high', 0n, 0n, 0n, 0n])
			const eventName = status === 'accepted' ? ('PriceReported' as const) : ('PriceReportRejected' as const)
			const log = { address: vaultAddress, data, topics: encodeEventTopics({ abi, eventName, args: { reportId: 7n } }) }
			const logs = [{ ...log, address: token1Address }, { ...log, topics: encodeEventTopics({ abi, eventName, args: { reportId: 8n } }) }, { ...log, topics: [] }, log]
			const client = { ...createMockWriteClient(() => {}), waitForTransactionReceipt: async () => ({ status: 'success' as const, logs }) }
			const result = await settleOracleReport(client, getOpenOracleAddress(), 7n, preimage)
			expect(result.priceSettlement).toEqual(status === 'accepted' ? { status } : { status, reason: 'Base fee too high' })
		})
	}

	test('settlement returns the coordinator rejection even when the transaction succeeds', async () => {
		const preimage = createOpenOraclePreimage(7n)
		preimage.game.callbackContract = vaultAddress
		const abi = statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi
		const rejection = {
			address: vaultAddress,
			data: encodeAbiParameters(parseAbiParameters('string,uint256,uint256,uint256,uint256'), ['Report stale', 0n, 0n, 0n, 0n]),
			topics: encodeEventTopics({ abi, eventName: 'PriceReportRejected', args: { reportId: 7n } }),
		}
		const client = {
			...createMockWriteClient(() => {}),
			waitForTransactionReceipt: async () => ({ status: 'success' as const, logs: [rejection] }),
		}
		const result = await settleOracleReport(client, getOpenOracleAddress(), 7n, preimage)
		expect(result.priceSettlement).toEqual({ status: 'rejected', reason: 'Report stale' })
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
				settlerRewardAttoEth: 0n,
				token1: token1Address,
				token2: token2Address,
			},
			helper: { blockNumber: 1n, blockTimestamp: 1n, creator: reporter, reportId: 7n },
		})

		expect(capturedTo).toBe(getOpenOracleAddress())
		expect(capturedGas).toBe(5_000_000n)
		expect(capturedData).toBeDefined()
		const decodedCall = decodeFunctionData({
			abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
			data: capturedData ?? ('0x' satisfies Hex),
		})
		expect(decodedCall.functionName).toBe('settle')
		expect(decodedCall.args?.[0]).toBe(7n)
	})

	test('settleOracleReport raises the gas limit to cover a large settlement callback', async () => {
		const callbackGasLimit = 10_000_000n
		const preimage = createOpenOraclePreimage(7n)
		preimage.game.callbackContract = getAddress('0x00000000000000000000000000000000000000f9')
		preimage.game.callbackGasLimit = callbackGasLimit
		let capturedGas: bigint | undefined
		const client = createMockWriteClient(request => {
			capturedGas = request.gas
		})

		await settleOracleReport(client, getOpenOracleAddress(), 7n, preimage)
		// EIP-150 forwards at most 63/64 of the remaining gas, and settle requires callbackGasLimit / 63 to remain afterwards.
		expect(capturedGas ?? 0n).toBeGreaterThan((callbackGasLimit * 64n) / 63n + callbackGasLimit / 63n)

		preimage.game.callbackGasLimit = 1_000n
		await settleOracleReport(client, getOpenOracleAddress(), 7n, preimage)
		expect(capturedGas).toBe(5_000_000n)
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
			ethAttoEth: 5n,
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
			const decodedCall = decodeFunctionData({ abi: statoblast_openOracle_OpenOracle_OpenOracle.abi, data })
			expect(decodedCall.functionName).toBe('withdrawTo')
			expect(decodedCall.args).toEqual([token1Address, 7n, holder])
		})

		await expect(withdrawOpenOracleBalance(writeClient, getOpenOracleAddress(), token1Address, 7n, holder)).rejects.toThrow('wallet rejected withdrawal')
		await expect(withdrawOpenOracleBalance(writeClient, getOpenOracleAddress(), token1Address, 7n, holder)).resolves.toMatchObject({ action: 'withdrawBalance' })
		expect(withdrawalAttempts).toBe(2)
	})

	test('loads the liquidation approval registry and encodes approval lifecycle writes', async () => {
		const coordinatorAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const registryAddress = getAddress('0x00000000000000000000000000000000000000a2')
		const receiverVault = getAddress('0x00000000000000000000000000000000000000a3')
		const operator = getAddress('0x00000000000000000000000000000000000000a4')
		const securityPool = getAddress('0x00000000000000000000000000000000000000a5')
		const params = {
			securityPool,
			receiverVault,
			operator,
			targetVault: zeroAddress,
			maxCumulativeDebtAttoEth: 10n,
			maxDebtPerLiquidationAttoEth: 2n,
			minPostLiquidationHealthFactorBps: 12_000n,
			validAfter: 1n,
			validUntil: 100n,
			nonce: 7n,
		} satisfies LiquidationApprovalParams
		const approvalId = toHex(9n, { size: 32 })
		const approvalState = {
			params,
			availableDebtAttoEth: 8n,
			reservedDebtAttoEth: 1n,
			consumedDebtAttoEth: 1n,
			revoked: false,
		}
		const approvalReadClient = createMockLoaderClient({
			getBlock: async () => ({ timestamp: 0n }),
			multicall: async () => [],
			readContract: async request => {
				switch (request.functionName) {
					case 'liquidationApprovalRegistry':
						return registryAddress
					case 'getLiquidationApproval':
						return approvalState
					case 'minimumLiquidationApprovalNonce':
						expect(request.args).toEqual([receiverVault])
						return 9n
					default:
						throw new Error(`Unexpected approval read ${request.functionName}`)
				}
			},
		})
		await expect(loadLiquidationApproval(approvalReadClient, coordinatorAddress, approvalId)).resolves.toEqual({ registryAddress, ...approvalState, minimumValidNonce: 9n })
	})
})

for (const change of ['settlement preimage', 'settled report', 'withdraw balance', 'create ETH', 'settlement unchanged', 'settlement price expiry', 'settlement stale unchanged', 'withdraw unchanged', 'create unchanged'] as const) {
	test(`refreshes OpenOracle ${change} after application review`, async () => {
		const preimage = createOpenOraclePreimage()
		const coordinatorReport = change === 'settlement price expiry' || change === 'settlement stale unchanged'
		if (coordinatorReport) preimage.game.callbackContract = vaultAddress
		let changed = false
		let submitted = 0
		const writer = createMockWriteClient(
			() => {
				submitted += 1
			},
			async request => {
				if (request.functionName === 'tokenHolder') return changed && change === 'withdraw balance' ? 1n : 1000n
				if (request.functionName === 'balanceOf' || request.functionName === 'allowance') return 1000n
				if (request.functionName === 'symbol') return 'REP'
				if (request.functionName === 'decimals') return 18
				return readStoredOracleFixture(request.functionName, preimage)
			},
		)
		const wallet = createWalletClient({
			account: initialReporter,
			chain: SEPOLIA_NETWORK_PROFILE.chain,
			transport: custom({
				request: async () => {
					throw new Error('Unexpected RPC')
				},
			}),
		}).extend(publicActions)
		const scope = new AbortController()
		const unregister = registerTransactionPreparationScope(scope.signal)
		const reviewed = createReviewedClient(
			{
				...wallet,
				...asWriteClient(writer),
				account: wallet.account,
				call: async () => ({ data: toHex(0n) }),
				multicall: createMulticallStub(async request =>
					getContractFunctionName(request.contracts[0]) === 'openOracle'
						? [
								{ status: 'success', result: getOpenOracleAddress() },
								{ status: 'success', result: alternateSecurityPoolAddress },
							]
						: [{ status: 'success', result: vaultAddress }],
				),
				getBlock: async () => createBlockWithTimestamp(change === 'settlement stale unchanged' || (changed && change === 'settlement price expiry') ? 3611n : 1000n),
				getBalance: async () => (changed && change === 'create ETH' ? 0n : 1000n),
			},
			undefined,
			scope.signal,
		)
		try {
			const execute = () => {
				if (change.startsWith('withdraw')) return withdrawOpenOracleBalance(reviewed, getOpenOracleAddress(), token1Address, 7n, initialReporter)
				if (change.startsWith('create'))
					return createOpenOracleReportInstance(reviewed, {
						disputeDelay: 0,
						escalationHalt: 1000n,
						exactToken1Report: 1n,
						initialToken2Amount: 1n,
						ethValueAttoEth: 1n,
						feePercentage: 0,
						multiplier: 100,
						protocolFee: 0,
						settlementTime: 1000,
						settlerRewardAttoEth: 1n,
						token1Address,
						token2Address,
					})
				return settleOracleReport(reviewed, getOpenOracleAddress(), 1n)
			}
			const action = execute().catch(error => error)
			for (let attempt = 0; attempt < 100 && transactionSteps.value?.steps.at(-1)?.phase !== 'review'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 1))
			expect(transactionSteps.value?.steps.at(-1)?.phase).toBe('review')
			if (change === 'settlement stale unchanged') expect(transactionSteps.value?.steps.at(-1)?.description).toBe('Settlement will clear this report, but the pool will reject its price.')
			changed = true
			if (change === 'settlement preimage') preimage.game.currentAmount1 = 101n
			if (change === 'settled report') preimage.game.settlementTimestamp = 1000n
			transactionSteps.value?.confirm()
			const result = await action
			if (change.endsWith('unchanged')) {
				expect(result).toHaveProperty('hash')
				expect(submitted).toBe(1)
				if (change === 'settlement stale unchanged') expect(result).toHaveProperty('priceSettlement', { status: 'unconfirmed' })
			} else {
				expect(result).toBeInstanceOf(Error)
				expect(submitted).toBe(0)
				if (change === 'settlement price expiry') expect(result.message).toContain('Price expired while reviewing')
			}
		} finally {
			scope.abort()
			unregister()
			transactionSteps.value?.cancel()
		}
	})
}
