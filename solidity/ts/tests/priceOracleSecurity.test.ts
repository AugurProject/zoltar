import { test, beforeEach, describe, setDefaultTimeout } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { decodeEventLog, encodeAbiParameters, encodeDeployData, encodeFunctionData, keccak256, type Address, type Hex, zeroAddress } from '@zoltar/shared/ethereum'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, hashOpenOracleStatePreimage, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS, MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, calculateOracleMinimumWethReportAttoEth } from '@zoltar/shared/oracleInitialReport'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient } from '../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, DAY, WETH_ADDRESS } from '../testSupport/simulator/utils/constants'
import { addressString, dateToBigintSeconds } from '../testSupport/simulator/utils/bigint'
import { approveToken, setupTestAccounts, getERC20Balance, getETHBalance } from '../testSupport/simulator/utils/utilities'
import { approveAndDepositRepToVault, handleOracleReporting, manipulatePriceOracle, manipulatePriceOracleAndPerformOperation } from '../testSupport/simulator/utils/contracts/peripheralsTestUtils'
import { OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, applyLibraries, deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import { createQuestion, getQuestionId } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { ensureZoltarDeployed } from '../testSupport/simulator/utils/contracts/zoltar'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import {
	OperationType,
	executeStagedOperation,
	getActiveStagedOperationCount,
	getActiveStagedOperations,
	getIsPriceValid,
	getLastPrice,
	getOpenOracleExtraData,
	getOpenOracleReportMeta,
	getOpenOracleReportStatus,
	loadOpenOracleEventState,
	getPendingOperationSlotId,
	getPendingReportId,
	getPendingReportMaxSettlementBaseFee,
	getPendingSettlementOperationCount,
	getPendingSettlementOperationIds,
	getQueuedOperationCostAttoEth,
	getRequestPriceCostAttoEth,
	getStagedOperation,
	openOracleSettle,
	openOracleSettleWithGasPrice,
	recoverSettledPendingReport,
	requestPrice,
	requestPriceIfNeededAndStageOperationWithInitialReportPrice,
	requestPriceIfNeededAndStageOperationWithValue,
	requestPriceWithValue,
	wrapWeth,
} from '../testSupport/simulator/utils/contracts/peripherals'
import { createCompleteSet, depositRepToVault, depositToEscalationGame, getSettlementCollateralAttoEth, getSecurityVault, getShareTokenSupplyAttoShares, getTotalAccruedFees, getTotalClaimableVaultFeesAttoEth } from '../testSupport/simulator/utils/contracts/securityPool'
import {
	peripherals_openOracle_OpenOracle_OpenOracle,
	peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	peripherals_SecurityPool_SecurityPool,
	peripherals_tokens_ShareToken_ShareToken,
	peripherals_WETH9_WETH9,
	ReputationToken_ReputationToken,
	test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver as rejectingEthReceiverArtifact,
} from '../types/contractArtifact'
import { isIgnorableLogDecodeError } from './logDecodeErrors'
import { replayZoltarEvents, type ReplayLog } from './eventReplay/eventReplayModel'

setDefaultTimeout(TEST_TIMEOUT_MS)

type TransactionReceiptLogs = Awaited<ReturnType<WriteClient['waitForTransactionReceipt']>>['logs']
const OPEN_ORACLE_GAME_MAPPING_SLOT = 1n
const MAX_OPEN_ORACLE_REPORT_COUNT = (1n << 24n) - 1n

const findExecutedStagedOperationLog = (logs: TransactionReceiptLogs) =>
	logs
		.map(log => {
			try {
				return decodeEventLog({
					abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
					data: log.data,
					topics: log.topics,
				})
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				return undefined
			}
		})
		.find(log => log?.eventName === 'ExecutedStagedOperation')

const findExecutedStagedOperationLogs = (logs: TransactionReceiptLogs) =>
	logs
		.map(log => {
			try {
				return decodeEventLog({
					abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
					data: log.data,
					topics: log.topics,
				})
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				return undefined
			}
		})
		.filter(log => log?.eventName === 'ExecutedStagedOperation')

const findPendingOperationRecoveryConsumedLog = (logs: TransactionReceiptLogs) =>
	logs
		.map(log => {
			try {
				return decodeEventLog({
					abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
					data: log.data,
					topics: log.topics,
				})
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				return undefined
			}
		})
		.find(log => log?.eventName === 'PendingOperationRecoveryConsumed')

const findPendingReportRecoveredLog = (logs: TransactionReceiptLogs) =>
	logs
		.map(log => {
			try {
				return decodeEventLog({
					abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
					data: log.data,
					topics: log.topics,
				})
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				return undefined
			}
		})
		.find(log => log?.eventName === 'PendingReportRecovered')

const findPriceReportedLog = (logs: TransactionReceiptLogs) =>
	logs
		.map(log => {
			try {
				return decodeEventLog({
					abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
					data: log.data,
					topics: log.topics,
				})
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				return undefined
			}
		})
		.find(log => log?.eventName === 'PriceReported')

const findPriceReportRejectedLog = (logs: TransactionReceiptLogs) =>
	logs
		.map(log => {
			try {
				return decodeEventLog({
					abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
					data: log.data,
					topics: log.topics,
				})
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				return undefined
			}
		})
		.find(log => log?.eventName === 'PriceReportRejected')

type OracleCoordinatorConstructorArgs = [Address, Address, Address, bigint, number, bigint, bigint, bigint, bigint, number, number, number, number, number, boolean, boolean, Address, bigint, bigint, bigint]

function encodeOracleCoordinatorDeployData(args: OracleCoordinatorConstructorArgs) {
	return encodeDeployData({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		bytecode: applyLibraries(peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.evm.bytecode.object),
		args,
	})
}

function formatStorageSlot(slot: bigint) {
	return `0x${slot.toString(16).padStart(64, '0')}`
}

function getMappingStorageSlot(key: bigint, mappingSlot: bigint) {
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [key, mappingSlot])))
}

const getOpenOracleHeldBalance = async (client: WriteClient, holder: Address, token: Address) =>
	await client.readContract({
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'tokenHolder',
		address: getInfraContractAddresses().openOracle,
		args: [holder, token],
	})

describe('Price Oracle Refund Security Tests', () => {
	const DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS = 5n * 60n
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const repDeposit = 1000n * 10n ** 18n
	const currentTimestamp = dateToBigintSeconds(new Date())
	const questionEndDate = currentTimestamp + 365n * DAY
	let priceOracle: Address
	let questionId: bigint
	const genesisUniverse = 0n
	const statoblastSecurityMultiplierBps = 20_000n
	const EXTRA_INFO = 'test question!'
	let securityPool: Address
	const ORACLE_REPORT_GAS = 100000n
	const ORACLE_SETTLEMENT_GAS = 1000000
	const ORACLE_SETTLEMENT_TIME = 40 * 12
	const ORACLE_DISPUTE_DELAY = 0
	const ORACLE_PROTOCOL_FEE = 100000
	const ORACLE_FEE_PERCENTAGE = 10000
	const ORACLE_MULTIPLIER = 115
	const ORACLE_TIME_TYPE = true
	const ORACLE_TRACK_DISPUTES = true
	const ORACLE_ESCALATION_HALT_MULTIPLIER_BPS = 100000n
	const ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS = 30000n
	const ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS = 1000n

	const getOracleCoordinatorConstructorArgs = (): OracleCoordinatorConstructorArgs => [
		getInfraContractAddresses().openOracle,
		addressString(GENESIS_REPUTATION_TOKEN),
		WETH_ADDRESS,
		ORACLE_REPORT_GAS,
		ORACLE_SETTLEMENT_GAS,
		ORACLE_GAS_UNITS_FOR_ONE_DISPUTE,
		DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS,
		ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
		OPEN_ORACLE_SECURITY_MULTIPLIER_BPS,
		ORACLE_SETTLEMENT_TIME,
		ORACLE_DISPUTE_DELAY,
		ORACLE_PROTOCOL_FEE,
		ORACLE_FEE_PERCENTAGE,
		ORACLE_MULTIPLIER,
		ORACLE_TIME_TYPE,
		ORACLE_TRACK_DISPUTES,
		zeroAddress,
		ORACLE_ESCALATION_HALT_MULTIPLIER_BPS,
		ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS,
		ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS,
	]

	const deployContract = async (deploymentData: Hex): Promise<Address> => {
		const hash = await client.sendTransaction({ data: deploymentData })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (typeof contractAddress !== 'string') throw new Error('deployment address missing')
		return contractAddress
	}

	const executeThroughRejectingReceiver = async (receiver: Address, target: Address, data: Hex, value = 0n) => {
		const hash = await client.writeContract({
			abi: rejectingEthReceiverArtifact.abi,
			address: receiver,
			functionName: 'execute',
			args: [target, data],
			value,
		})
		await client.waitForTransactionReceipt({ hash })
	}

	const settlePendingReportWithFailedCallback = async (pendingReportId: bigint) => {
		const openOracle = getInfraContractAddresses().openOracle
		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
		const eventState = await loadOpenOracleEventState(client, pendingReportId)
		const overriddenPreimage: OpenOracleStatePreimage = {
			...eventState.latest,
			game: { ...eventState.latest.game, callbackGasLimit: 1n },
		}
		const gameSlot = getMappingStorageSlot(pendingReportId, OPEN_ORACLE_GAME_MAPPING_SLOT)
		await mockWindow.addStateOverrides({
			[openOracle]: {
				stateDiff: {
					[formatStorageSlot(gameSlot)]: BigInt(hashOpenOracleStatePreimage(overriddenPreimage)),
				},
			},
		})

		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await client.writeContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'settle',
			args: [pendingReportId, getOpenOracleGameTuple(overriddenPreimage.game), getOpenOracleHelperTuple(overriddenPreimage.helper)],
		})
	}

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		// Create the question on-chain first
		const questionData = {
			title: EXTRA_INFO,
			description: '',
			startTime: 0n,
			endTime: questionEndDate,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = ['Yes', 'No']
		await createQuestion(client, questionData, outcomes)
		questionId = getQuestionId(questionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, questionId, statoblastSecurityMultiplierBps)
		await approveAndDepositRepToVault(client, repDeposit, questionId)
		const addresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, statoblastSecurityMultiplierBps)
		priceOracle = addresses.priceOracleManagerAndOperatorQueuer
		securityPool = addresses.securityPool
	})

	const queueStagedOperation = async (operation: OperationType, targetVault: Address, amount: bigint, validForSeconds: bigint, value = 0n) => await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, operation, targetVault, amount, validForSeconds, value)
	const fillPendingSettlementOperationList = async (costAttoEth: bigint, queuedOperationCostAttoEth: bigint, validForSeconds: bigint) => {
		for (let index = 0; index < 4; index++) {
			await queueStagedOperation(OperationType.SetCoverageCommitment, client.account.address, BigInt(index + 1), validForSeconds, index === 0 ? costAttoEth : queuedOperationCostAttoEth)
		}
	}

	const settlePendingReportWithPrice = async (forceRepEthPriceTo: bigint) => {
		const pendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(pendingReportId > 0n, 'Operation is not queued')
		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
		assert.strictEqual(forceRepEthPriceTo, 10n ** 18n, 'test helper expects the coordinator default initial report price')
		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		const settleHash = await openOracleSettle(client, pendingReportId)
		const settleReceipt = await client.waitForTransactionReceipt({ hash: settleHash })
		return { pendingReportId, settleReceipt }
	}

	const readPoolGuardState = async (vaults: Address[]) => {
		const repToken = addressString(GENESIS_REPUTATION_TOKEN)
		return {
			escalationGame: await client.readContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: securityPool,
				functionName: 'escalationGame',
				args: [],
			}),
			poolAccounting: await client.readContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: securityPool,
				functionName: 'getPoolAccountingSnapshot',
				args: [],
			}),
			totalRepBackingUnits: await client.readContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: securityPool,
				functionName: 'totalRepBackingUnits',
				args: [],
			}),
			poolRep: await getERC20Balance(client, repToken, securityPool),
			vaults: await Promise.all(
				vaults.map(async vault => ({
					address: vault,
					rep: await getERC20Balance(client, repToken, vault),
					state: await getSecurityVault(client, securityPool, vault),
				})),
			),
		}
	}

	const assertCoordinatorReplayMatchesStorage = async (logs: TransactionReceiptLogs, context: string) => {
		const chainId = BigInt(await client.getChainId())
		const replayLogs: ReplayLog[] = []
		for (const log of logs) {
			if (log.address.toLowerCase() !== priceOracle.toLowerCase()) continue
			let decoded: ReturnType<typeof decodeEventLog>
			try {
				decoded = decodeEventLog({
					abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
					data: log.data,
					topics: log.topics,
				})
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				continue
			}
			if (
				log.blockHash === null ||
				log.blockHash === undefined ||
				log.blockNumber === null ||
				log.blockNumber === undefined ||
				log.transactionHash === null ||
				log.transactionHash === undefined ||
				log.transactionIndex === null ||
				log.logIndex === null ||
				typeof decoded.args !== 'object' ||
				decoded.args === null ||
				Array.isArray(decoded.args)
			) {
				throw new Error(`${context}: coordinator log identity or named arguments are incomplete`)
			}
			replayLogs.push({
				chainId,
				blockHash: log.blockHash,
				blockNumber: log.blockNumber,
				transactionHash: log.transactionHash,
				transactionIndex: Number(log.transactionIndex),
				logIndex: Number(log.logIndex),
				emitter: log.address,
				eventName: decoded.eventName,
				args: Object.fromEntries(Object.entries(decoded.args)),
			})
		}
		const replayed = replayZoltarEvents(replayLogs).coordinators.get(priceOracle)
		if (replayed === undefined || replayed.checkpointReason === undefined) throw new Error(`${context}: coordinator state checkpoint was not replayed`)
		const [pendingReportId, pendingReportSponsor, pendingOperationSlotId, pendingReportMaxSettlementBaseFeeAttoEthPerGas, lastPrice, lastSettlementTimestamp, stagedOperationCounter, activeStagedOperationCount, pendingSettlementOperationCount] = await Promise.all([
			getPendingReportId(client, priceOracle),
			client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'pendingReportSponsor', address: priceOracle, args: [] }),
			getPendingOperationSlotId(client, priceOracle),
			getPendingReportMaxSettlementBaseFee(client, priceOracle),
			getLastPrice(client, priceOracle),
			client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'lastSettlementTimestamp', address: priceOracle, args: [] }),
			client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'stagedOperationCounter', address: priceOracle, args: [] }),
			getActiveStagedOperationCount(client, priceOracle),
			getPendingSettlementOperationCount(client, priceOracle),
		])
		assert.strictEqual(replayed.pendingReportId, pendingReportId, `${context}: pending report replay mismatch`)
		assert.strictEqual(replayed.pendingReportSponsor, pendingReportSponsor, `${context}: report sponsor replay mismatch`)
		assert.strictEqual(replayed.pendingOperationSlotId, pendingOperationSlotId, `${context}: pending operation replay mismatch`)
		assert.strictEqual(replayed.pendingReportMaxSettlementBaseFeeAttoEthPerGas, pendingReportMaxSettlementBaseFeeAttoEthPerGas, `${context}: settlement base-fee replay mismatch`)
		assert.strictEqual(replayed.lastPrice, lastPrice, `${context}: last price replay mismatch`)
		assert.strictEqual(replayed.lastSettlementTimestamp, lastSettlementTimestamp, `${context}: settlement timestamp replay mismatch`)
		assert.strictEqual(replayed.stagedOperationCounter, stagedOperationCounter, `${context}: operation counter replay mismatch`)
		assert.strictEqual(replayed.activeStagedOperationCount, activeStagedOperationCount, `${context}: active operation count replay mismatch`)
		assert.strictEqual(replayed.pendingSettlementOperationCount, pendingSettlementOperationCount, `${context}: pending settlement count replay mismatch`)
	}

	test('coordinator dynamically sizes the minimum WETH report side from the current base fee', async () => {
		const sizingConfigurationAbi = [
			{
				inputs: [],
				name: 'targetPriceErrorForDispute',
				outputs: [{ type: 'uint256' }],
				stateMutability: 'view',
				type: 'function',
			},
			{
				inputs: [],
				name: 'openOracleSecurityMultiplierBps',
				outputs: [{ type: 'uint256' }],
				stateMutability: 'view',
				type: 'function',
			},
		] as const
		const targetPriceErrorForDispute = await client.readContract({ abi: sizingConfigurationAbi, functionName: 'targetPriceErrorForDispute', address: priceOracle, args: [] })
		const openOracleSecurityMultiplierBps = await client.readContract({ abi: sizingConfigurationAbi, functionName: 'openOracleSecurityMultiplierBps', address: priceOracle, args: [] })
		assert.strictEqual(targetPriceErrorForDispute, 500000n, 'the initial target price error should be five percent')
		assert.strictEqual(openOracleSecurityMultiplierBps, 100000n, 'the initial Open Oracle Security multiplier should be ten times gas cost')

		const minimumToken1ReportAttoEth = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1ReportAttoEth',
			address: priceOracle,
			args: [],
		})

		assert.strictEqual(minimumToken1ReportAttoEth, calculateOracleMinimumWethReportAttoEth(), 'zero-basefee test chains should retain the configured priority-fee report')
		await requestPrice(client, priceOracle)

		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		assert.strictEqual(reportMeta.exactToken1Report, minimumToken1ReportAttoEth, 'the request should snapshot the dynamic WETH requirement')
		assert.strictEqual(reportMeta.token1, WETH_ADDRESS, 'WETH should be the exact token1 report side')
		assert.strictEqual(reportMeta.token2.toLowerCase(), addressString(GENESIS_REPUTATION_TOKEN).toLowerCase(), 'REP should be the price-expressing token2 side')

		const baseFeeAttoEthPerGas = 30n * 10n ** 9n
		await mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${baseFeeAttoEthPerGas.toString(16)}`] })
		await mockWindow.request({ method: 'evm_mine', params: [] })
		const sizedForBaseFee = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1ReportAttoEth',
			address: priceOracle,
			args: [],
		})
		assert.strictEqual(sizedForBaseFee, calculateOracleMinimumWethReportAttoEth({ ...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS, baseFeeAttoEthPerGas }), 'the on-chain WETH calculation should match the shared integer formula')
	})

	test('coordinator adds priority-fee security to the open-interest-dependent initial report', async () => {
		const openInterest = 100n * 10n ** 18n + 1n
		const expectedOpenInterestMinimum = (openInterest + 99n) / 100n
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		await requestPriceIfNeededAndStageOperationWithInitialReportPrice(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, openInterest, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 10n ** 18n, costAttoEth)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await createCompleteSet(client, securityPool, openInterest)

		const minimumToken1ReportAttoEth = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1ReportAttoEth',
			address: priceOracle,
			args: [],
		})

		const expectedMinimumToken1Report = calculateOracleMinimumWethReportAttoEth({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			openInterestAttoEth: openInterest,
		})
		assert.strictEqual(minimumToken1ReportAttoEth, expectedMinimumToken1Report, 'pool open interest should replace the lower base-fee-dependent report before priority security is added')
		await mockWindow.advanceTime(5n * 60n + 1n)
		await requestPrice(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, await getPendingReportId(client, priceOracle))
		assert.strictEqual(reportMeta.exactToken1Report, expectedMinimumToken1Report, 'the pending game should retain the priority plus open-interest initial WETH amount')
		assert.strictEqual(reportMeta.escalationHalt, expectedMinimumToken1Report * 10n, 'the priority plus open-interest initial report should set the larger escalation halt')
		assert.ok(reportMeta.escalationHalt > expectedOpenInterestMinimum)
	})

	test('caller can voluntarily fund initial WETH above the coordinator minimum', async () => {
		const proposedRepPerEthPrice = 10n ** 18n
		const requestedInitialWethAttoEth = calculateOracleMinimumWethReportAttoEth() * 2n
		const requestPriceWithMinimumAbi = [
			{
				inputs: [
					{ name: 'proposedRepPerEthPrice', type: 'uint256' },
					{ name: 'requestedInitialWethAttoEth', type: 'uint256' },
				],
				name: 'requestPrice',
				outputs: [],
				stateMutability: 'payable',
				type: 'function',
			},
		] as const

		await wrapWeth(client, requestedInitialWethAttoEth)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)

		const hash = await client.writeContract({
			abi: requestPriceWithMinimumAbi,
			functionName: 'requestPrice',
			address: priceOracle,
			args: [proposedRepPerEthPrice, requestedInitialWethAttoEth],
			value: await getRequestPriceCostAttoEth(client, priceOracle),
		})
		await client.waitForTransactionReceipt({ hash })

		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		const reportStatus = await getOpenOracleReportStatus(client, reportId)
		assert.strictEqual(reportMeta.exactToken1Report, requestedInitialWethAttoEth, 'OpenOracle should require the larger caller-selected initial WETH amount')
		assert.strictEqual(reportMeta.escalationHalt, requestedInitialWethAttoEth * 10n, 'the escalation halt should scale from the actual initial WETH amount')
		assert.strictEqual(reportStatus.currentAmount1, requestedInitialWethAttoEth, 'the initial report should contain the caller-selected WETH amount')
		assert.strictEqual(reportStatus.currentAmount2, requestedInitialWethAttoEth, 'the coordinator should derive matching REP from the selected WETH amount and proposed price')
	})

	test('coordinator settlement returns the undisputed report liquidity to the sponsor wallet', async () => {
		const proposedRepPerEthPrice = 10n ** 18n
		const requestedInitialWethAttoEth = calculateOracleMinimumWethReportAttoEth() * 2n
		await wrapWeth(client, requestedInitialWethAttoEth)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)
		const wethBalanceAttoEthBeforeRequest = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
		const repBalanceBeforeRequest = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		await requestPriceWithValue(client, priceOracle, await getRequestPriceCostAttoEth(client, priceOracle), proposedRepPerEthPrice, requestedInitialWethAttoEth)
		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		const reportStatus = await getOpenOracleReportStatus(client, reportId)
		assert.strictEqual(reportStatus.currentReporter, priceOracle, 'the coordinator should own the initial reporter position until settlement')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), wethBalanceAttoEthBeforeRequest - requestedInitialWethAttoEth, 'the pending report should hold the sponsored WETH')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), repBalanceBeforeRequest - requestedInitialWethAttoEth, 'the pending report should hold the sponsored REP')

		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await openOracleSettle(client, reportId)
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), wethBalanceAttoEthBeforeRequest, 'settlement should return the coordinator reporter WETH to the sponsor')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), repBalanceBeforeRequest, 'settlement should return the coordinator reporter REP to the sponsor')
	})

	test('oracle settlement distinguishes direct coordinator balances from OpenOracle beneficiary credits', async () => {
		const donor = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const donatedWeth = 3n * 10n ** 15n
		const donatedRep = 5n * 10n ** 18n
		const openOracleDonatedWeth = 2n * 10n ** 15n
		const openOracleDonatedRep = 4n * 10n ** 18n
		const openOracle = getInfraContractAddresses().openOracle
		await wrapWeth(donor, donatedWeth)
		const wethDonationHash = await donor.writeContract({
			abi: peripherals_WETH9_WETH9.abi,
			functionName: 'transfer',
			address: WETH_ADDRESS,
			args: [priceOracle, donatedWeth],
		})
		await donor.waitForTransactionReceipt({ hash: wethDonationHash })
		const repDonationHash = await donor.writeContract({
			abi: ReputationToken_ReputationToken.abi,
			functionName: 'transfer',
			address: addressString(GENESIS_REPUTATION_TOKEN),
			args: [priceOracle, donatedRep],
		})
		await donor.waitForTransactionReceipt({ hash: repDonationHash })

		const coordinatorWethSurplus = await getERC20Balance(client, WETH_ADDRESS, priceOracle)
		const coordinatorRepSurplus = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)
		assert.strictEqual(coordinatorWethSurplus, donatedWeth, 'the coordinator should hold the unsolicited WETH outside OpenOracle')
		assert.strictEqual(coordinatorRepSurplus, donatedRep, 'the coordinator should hold the unsolicited REP outside OpenOracle')

		const proposedRepPerEthPrice = 10n ** 18n
		const requestedInitialWethAttoEth = calculateOracleMinimumWethReportAttoEth() * 2n
		await wrapWeth(client, requestedInitialWethAttoEth)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)
		const sponsorWethBeforeRequest = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
		const sponsorRepBeforeRequest = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		await requestPriceWithValue(client, priceOracle, await getRequestPriceCostAttoEth(client, priceOracle), proposedRepPerEthPrice, requestedInitialWethAttoEth)
		const reportId = await getPendingReportId(client, priceOracle)
		const openOracleWethBeforeDonation = await getOpenOracleHeldBalance(client, priceOracle, WETH_ADDRESS)
		const openOracleRepBeforeDonation = await getOpenOracleHeldBalance(client, priceOracle, addressString(GENESIS_REPUTATION_TOKEN))
		assert.strictEqual(openOracleWethBeforeDonation, 1n, 'a pending report should leave only the coordinator WETH sentinel outside the game')
		assert.strictEqual(openOracleRepBeforeDonation, 1n, 'a pending report should leave only the coordinator REP sentinel outside the game')

		await wrapWeth(donor, openOracleDonatedWeth)
		await approveToken(donor, WETH_ADDRESS, openOracle)
		await approveToken(donor, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
		for (const [token, amount] of [
			[WETH_ADDRESS, openOracleDonatedWeth],
			[addressString(GENESIS_REPUTATION_TOKEN), openOracleDonatedRep],
		] as const) {
			const depositHash = await donor.writeContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'deposit',
				address: openOracle,
				args: [token, amount, priceOracle],
			})
			await donor.waitForTransactionReceipt({ hash: depositHash })
		}
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, WETH_ADDRESS), openOracleWethBeforeDonation + openOracleDonatedWeth, 'permissionless OpenOracle deposits should credit the coordinator beneficiary balance')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, addressString(GENESIS_REPUTATION_TOKEN)), openOracleRepBeforeDonation + openOracleDonatedRep, 'permissionless OpenOracle REP deposits should credit the same coordinator beneficiary balance')

		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await openOracleSettle(client, reportId)

		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), sponsorWethBeforeRequest + openOracleDonatedWeth, 'settlement should send the sponsor every withdrawable WETH credit held internally for the coordinator')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), sponsorRepBeforeRequest + openOracleDonatedRep, 'settlement should send the sponsor every withdrawable REP credit held internally for the coordinator')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, WETH_ADDRESS), 1n, 'settlement should drain the coordinator OpenOracle WETH credit to its sentinel')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, addressString(GENESIS_REPUTATION_TOKEN)), 1n, 'settlement should drain the coordinator OpenOracle REP credit to its sentinel')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, priceOracle), coordinatorWethSurplus, 'settlement must not sweep unsolicited coordinator WETH into sponsor proceeds')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle), coordinatorRepSurplus, 'settlement must not sweep unsolicited coordinator REP into sponsor proceeds')
	})

	test('request-block WETH sizing preserves the submitted REP per ETH price after basefee moves', async () => {
		const requestBaseFeeAttoEthPerGas = 45n * 10n ** 9n
		const proposedRepPerEthPrice = 1000n * 10n ** 18n
		const maximumMinimumWethReport = calculateOracleMinimumWethReportAttoEth({ ...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS, baseFeeAttoEthPerGas: requestBaseFeeAttoEthPerGas })
		await wrapWeth(client, maximumMinimumWethReport)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)

		await mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${requestBaseFeeAttoEthPerGas.toString(16)}`] })
		await mockWindow.request({ method: 'evm_mine', params: [] })
		const requestMinimumWethReport = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1ReportAttoEth',
			address: priceOracle,
			args: [],
		})
		const requestHash = await client.writeContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPrice',
			address: priceOracle,
			args: [proposedRepPerEthPrice, 0n],
			value: (await getRequestPriceCostAttoEth(client, priceOracle)) + requestMinimumWethReport,
			gasPrice: requestBaseFeeAttoEthPerGas,
		})
		await client.waitForTransactionReceipt({ hash: requestHash })

		const reportStatus = await getOpenOracleReportStatus(client, await getPendingReportId(client, priceOracle))
		const expectedRepAmount = (reportStatus.currentAmount1 * proposedRepPerEthPrice + 10n ** 18n - 1n) / 10n ** 18n
		assert.strictEqual(reportStatus.currentAmount2, expectedRepAmount, 'the coordinator should derive REP from the proposed price and request-block WETH amount')
	})

	test('coordinator deployments can tune the target price error and Open Oracle Security multiplier', async () => {
		const tunedTargetPriceError = 1000000n
		const tunedOpenOracleSecurityMultiplierBps = 30000n
		const tunedArgs = getOracleCoordinatorConstructorArgs()
		tunedArgs[7] = tunedTargetPriceError
		tunedArgs[8] = tunedOpenOracleSecurityMultiplierBps
		const tunedCoordinator = await deployContract(encodeOracleCoordinatorDeployData(tunedArgs))

		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'targetPriceErrorForDispute', address: tunedCoordinator, args: [] }), tunedTargetPriceError)
		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'openOracleSecurityMultiplierBps', address: tunedCoordinator, args: [] }), tunedOpenOracleSecurityMultiplierBps)

		const baseFeeAttoEthPerGas = 30n * 10n ** 9n
		await mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${baseFeeAttoEthPerGas.toString(16)}`] })
		await mockWindow.request({ method: 'evm_mine', params: [] })
		assert.strictEqual(
			await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'minimumToken1ReportAttoEth', address: tunedCoordinator, args: [] }),
			calculateOracleMinimumWethReportAttoEth({
				...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
				baseFeeAttoEthPerGas,
				openOracleSecurityMultiplierBps: tunedOpenOracleSecurityMultiplierBps,
				targetPriceErrorForDispute: tunedTargetPriceError,
			}),
		)
	})

	test('coordinator constructor rejects a priority fee that would exhaust OpenOracle report limits', async () => {
		const maximumArgs = getOracleCoordinatorConstructorArgs()
		maximumArgs[6] = MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS
		const maximumCoordinator = await deployContract(encodeOracleCoordinatorDeployData(maximumArgs))
		const maximumMinimumReport = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1ReportAttoEth',
			address: maximumCoordinator,
			args: [],
		})
		assert.ok(maximumMinimumReport <= (1n << 128n) - 1n, 'largest configured priority fee should retain room for a dynamic report component')

		const invalidArgs = getOracleCoordinatorConstructorArgs()
		invalidArgs[6] = MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS + 1n
		await assert.rejects(async () => await deployContract(encodeOracleCoordinatorDeployData(invalidArgs)), /initial report priority fee exceeds openoracle limits/i)
	})

	test('coordinator constructor rejects unsafe oracle risk parameters', async () => {
		const baseArgs = getOracleCoordinatorConstructorArgs()
		const buildArgsWithSizingParameters = (gasUnitsForOneDispute: bigint, targetPriceErrorForDispute: bigint, openOracleSecurityMultiplierBps: bigint, protocolFee: number, feePercentage: number): OracleCoordinatorConstructorArgs => [
			baseArgs[0],
			baseArgs[1],
			baseArgs[2],
			baseArgs[3],
			baseArgs[4],
			gasUnitsForOneDispute,
			baseArgs[6],
			targetPriceErrorForDispute,
			openOracleSecurityMultiplierBps,
			baseArgs[9],
			baseArgs[10],
			protocolFee,
			feePercentage,
			baseArgs[13],
			baseArgs[14],
			baseArgs[15],
			baseArgs[16],
			baseArgs[17],
			baseArgs[18],
			baseArgs[19],
		]
		const buildArgsWithRiskParameters = (escalationHaltMultiplierBps: bigint, maxSettlementBaseFeeMultiplierBps: bigint, minLiquidationPriceDistanceBps: bigint): OracleCoordinatorConstructorArgs => [
			baseArgs[0],
			baseArgs[1],
			baseArgs[2],
			baseArgs[3],
			baseArgs[4],
			baseArgs[5],
			baseArgs[6],
			baseArgs[7],
			baseArgs[8],
			baseArgs[9],
			baseArgs[10],
			baseArgs[11],
			baseArgs[12],
			baseArgs[13],
			baseArgs[14],
			baseArgs[15],
			baseArgs[16],
			escalationHaltMultiplierBps,
			maxSettlementBaseFeeMultiplierBps,
			minLiquidationPriceDistanceBps,
		]
		const invalidRiskParameterCases: Array<{ args: OracleCoordinatorConstructorArgs; message: RegExp }> = [
			{
				args: [...baseArgs.slice(0, 6), 0n, ...baseArgs.slice(7)] as OracleCoordinatorConstructorArgs,
				message: /initial priority fee zero/i,
			},
			{
				args: [...baseArgs.slice(0, 15), false, ...baseArgs.slice(16)] as OracleCoordinatorConstructorArgs,
				message: /revert/i,
			},
			{
				args: buildArgsWithSizingParameters(0n, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_PROTOCOL_FEE, ORACLE_FEE_PERCENTAGE),
				message: /dispute gas units zero/i,
			},
			{
				args: buildArgsWithSizingParameters(ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, 9999n, ORACLE_PROTOCOL_FEE, ORACLE_FEE_PERCENTAGE),
				message: /open oracle security multiplier must be at least one hundred percent/i,
			},
			{
				args: buildArgsWithSizingParameters(ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, 10000001n, OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_PROTOCOL_FEE, ORACLE_FEE_PERCENTAGE),
				message: /target price error cannot exceed one hundred percent/i,
			},
			{
				args: buildArgsWithSizingParameters(ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, 490000, 10000),
				message: /oracle fees must be below the target price error/i,
			},
			{
				args: buildArgsWithSizingParameters(ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, (2n ** 256n - 1n) / (10000000n + ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE) + 1n, ORACLE_PROTOCOL_FEE, ORACLE_FEE_PERCENTAGE),
				message: /open oracle security multiplier is too large/i,
			},
			{
				args: buildArgsWithRiskParameters(0n, ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS, ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS),
				message: /escalation multiplier zero/i,
			},
			{
				args: buildArgsWithRiskParameters(ORACLE_ESCALATION_HALT_MULTIPLIER_BPS, 9999n, ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS),
				message: /max settlement base fee multiplier must be at least one hundred percent/i,
			},
			{
				args: buildArgsWithRiskParameters(ORACLE_ESCALATION_HALT_MULTIPLIER_BPS, ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS, 10001n),
				message: /minimum liquidation price distance cannot exceed one hundred percent/i,
			},
		]

		for (const invalidCase of invalidRiskParameterCases) {
			await assert.rejects(async () => await deployContract(encodeOracleCoordinatorDeployData(invalidCase.args)), invalidCase.message)
		}
	})

	test('coordinator setup and price seeding reject repeated or unauthorized callers without changing state', async () => {
		const coordinatorAbi = peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi
		const configuredPool = await client.readContract({
			abi: coordinatorAbi,
			address: priceOracle,
			functionName: 'securityPool',
			args: [],
		})
		const lastPriceBefore = await getLastPrice(client, priceOracle)

		await assert.rejects(
			client.writeContract({
				abi: coordinatorAbi,
				address: priceOracle,
				functionName: 'setSecurityPool',
				args: [configuredPool],
			}),
			/Security pool already set/,
		)
		await assert.rejects(
			client.writeContract({
				abi: coordinatorAbi,
				address: priceOracle,
				functionName: 'setRepEthPrice',
				args: [lastPriceBefore + 1n],
			}),
			/Only security pool/,
		)

		assert.strictEqual(
			await client.readContract({
				abi: coordinatorAbi,
				address: priceOracle,
				functionName: 'securityPool',
				args: [],
			}),
			configuredPool,
			'rejected repeated setup must preserve the configured pool',
		)
		assert.strictEqual(await getLastPrice(client, priceOracle), lastPriceBefore, 'rejected price seed must preserve the last price')
	})

	test('request and callback guards cover funding, empty recovery, duplicate reports, caller identity, and fixed-width bounds', async () => {
		const coordinatorAbi = peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)

		await assert.rejects(
			client.writeContract({
				abi: coordinatorAbi,
				address: priceOracle,
				functionName: 'requestPrice',
				args: [1n, 0n],
				value: costAttoEth - 1n,
			}),
			/Oracle bounty too small/,
		)
		await assert.rejects(
			client.writeContract({
				abi: coordinatorAbi,
				address: priceOracle,
				functionName: 'requestPrice',
				args: [0n, 0n],
				value: costAttoEth,
			}),
			/Initial oracle price zero/,
		)
		await assert.rejects(recoverSettledPendingReport(client, priceOracle), /No pending oracle price request can be recovered/)
		await assert.rejects(
			client.writeContract({
				abi: coordinatorAbi,
				address: priceOracle,
				functionName: 'openOracleCallback',
				args: [1n, 1n, 1n, 0n, zeroAddress, zeroAddress],
			}),
			/Only OpenOracle/,
		)

		const openOracleAddress = getInfraContractAddresses().openOracle
		await mockWindow.impersonateAccount(openOracleAddress)
		const openOracleClient = createWriteClient(mockWindow, BigInt(openOracleAddress), 0)
		await assert.rejects(
			openOracleClient.writeContract({
				abi: coordinatorAbi,
				address: priceOracle,
				functionName: 'openOracleCallback',
				args: [1n, 1n, 1n, 0n, zeroAddress, zeroAddress],
			}),
			/Oracle callback report id does not match the pending request/,
		)

		await assert.rejects(
			client.writeContract({
				abi: coordinatorAbi,
				address: priceOracle,
				functionName: 'requestPrice',
				args: [1n, 1n << 128n],
				value: costAttoEth,
			}),
			/WETH report exceeds uint128/,
		)
		await assert.rejects(
			client.writeContract({
				abi: coordinatorAbi,
				address: priceOracle,
				functionName: 'requestPrice',
				args: [(1n << 128n) * 10n ** 18n, 1n],
				value: costAttoEth,
			}),
			/REP report exceeds uint128/,
		)
		await assert.rejects(
			client.writeContract({
				abi: coordinatorAbi,
				address: priceOracle,
				functionName: 'requestPrice',
				args: [1n, (1n << 128n) / 10n + 1n],
				value: costAttoEth,
			}),
			/Oracle escalation halt amount exceeds uint128 maximum/,
		)

		await requestPrice(client, priceOracle)
		await assert.rejects(requestPriceWithValue(client, priceOracle, costAttoEth), /Oracle request already pending/)
	})

	test('staged operation public guards cover argument geometry, request funding, and execution prerequisites', async () => {
		const coordinatorAbi = peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi
		const otherVault = addressString(TEST_ADDRESSES[1])
		const stage = (operation: OperationType, targetVault: Address, amount: bigint, validForSeconds: bigint, value = 0n) =>
			client.writeContract({
				abi: coordinatorAbi,
				address: priceOracle,
				functionName: 'requestPriceIfNeededAndStageOperation',
				args: [operation, targetVault, amount, validForSeconds, 1n, 0n],
				value,
			})

		await assert.rejects(stage(OperationType.WithdrawRep, client.account.address, 0n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS), /Staged operation amount must be non-zero/)
		await assert.rejects(stage(OperationType.SetCoverageCommitment, client.account.address, 0n, 0n), /Staged operation timeout must be positive/)
		await assert.rejects(stage(OperationType.SetCoverageCommitment, client.account.address, 0n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS + 1n), /Staged operation timeout exceeds the maximum allowed/)
		await assert.rejects(stage(OperationType.SetCoverageCommitment, otherVault, 0n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS), /Self operation target mismatch/)
		await assert.rejects(stage(OperationType.Liquidation, client.account.address, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS), /Caller bad/)
		await assert.rejects(
			client.writeContract({
				abi: coordinatorAbi,
				address: priceOracle,
				functionName: 'executeStagedOperation',
				args: [1n],
			}),
			/Staged operation unavailable/,
		)

		const counterBefore = await client.readContract({ abi: coordinatorAbi, address: priceOracle, functionName: 'stagedOperationCounter', args: [] })
		await assert.rejects(stage(OperationType.SetCoverageCommitment, client.account.address, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS), /Not enough ETH was provided to request a fresh oracle price/)
		assert.strictEqual(await client.readContract({ abi: coordinatorAbi, address: priceOracle, functionName: 'stagedOperationCounter', args: [] }), counterBefore, 'underfunded staging should roll back its operation record')

		const minimumInitialWeth = await client.readContract({
			abi: coordinatorAbi,
			address: priceOracle,
			functionName: 'minimumToken1ReportAttoEth',
			args: [],
		})
		await wrapWeth(client, minimumInitialWeth)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)
		await stage(OperationType.SetCoverageCommitment, client.account.address, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, await getRequestPriceCostAttoEth(client, priceOracle))
		await assert.rejects(
			client.writeContract({
				abi: coordinatorAbi,
				address: priceOracle,
				functionName: 'executeStagedOperation',
				args: [counterBefore + 1n],
			}),
			/Valid oracle price required/,
		)
	})

	test('rejecting sponsors roll back direct bounty refunds and staged-operation unused ETH refunds', async () => {
		const coordinatorAbi = peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi
		const receiver = await deployContract(
			encodeDeployData({
				abi: rejectingEthReceiverArtifact.abi,
				bytecode: `0x${rejectingEthReceiverArtifact.evm.bytecode.object}`,
			}),
		)
		const oraclePricePrecision = 10n ** 18n
		const proposedRepPerEthPrice = 1n
		const minimumInitialWeth = await client.readContract({
			abi: coordinatorAbi,
			address: priceOracle,
			functionName: 'minimumToken1ReportAttoEth',
			args: [],
		})
		const initialWethReport = minimumInitialWeth + oraclePricePrecision
		const initialRepReport = (initialWethReport * proposedRepPerEthPrice + oraclePricePrecision - 1n) / oraclePricePrecision
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)

		await executeThroughRejectingReceiver(receiver, WETH_ADDRESS, encodeFunctionData({ abi: peripherals_WETH9_WETH9.abi, functionName: 'deposit', args: [] }), initialWethReport)
		const repTransferHash = await client.writeContract({
			abi: ReputationToken_ReputationToken.abi,
			address: addressString(GENESIS_REPUTATION_TOKEN),
			functionName: 'transfer',
			args: [receiver, initialRepReport],
		})
		await client.waitForTransactionReceipt({ hash: repTransferHash })
		await executeThroughRejectingReceiver(
			receiver,
			WETH_ADDRESS,
			encodeFunctionData({
				abi: peripherals_WETH9_WETH9.abi,
				functionName: 'approve',
				args: [priceOracle, initialWethReport],
			}),
		)
		await executeThroughRejectingReceiver(
			receiver,
			addressString(GENESIS_REPUTATION_TOKEN),
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'approve',
				args: [priceOracle, initialRepReport],
			}),
		)

		const nextReportIdBefore = await client.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: getInfraContractAddresses().openOracle,
			functionName: 'nextReportId',
			args: [],
		})
		const wethBefore = await getERC20Balance(client, WETH_ADDRESS, receiver)
		const repBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), receiver)
		await assert.rejects(
			executeThroughRejectingReceiver(
				receiver,
				priceOracle,
				encodeFunctionData({
					abi: coordinatorAbi,
					functionName: 'requestPrice',
					args: [proposedRepPerEthPrice, initialWethReport],
				}),
				costAttoEth + 1n,
			),
			/Oracle coordinator failed to refund excess ETH bounty/,
		)
		assert.strictEqual(await getPendingReportId(client, priceOracle), 0n, 'failed direct refund must roll back the pending report')
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: getInfraContractAddresses().openOracle,
				functionName: 'nextReportId',
				args: [],
			}),
			nextReportIdBefore,
			'failed direct refund must roll back OpenOracle report creation',
		)
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, receiver), wethBefore, 'failed direct refund must restore sponsor WETH')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), receiver), repBefore, 'failed direct refund must restore sponsor REP')

		const stagedCounterBefore = await client.readContract({ abi: coordinatorAbi, address: priceOracle, functionName: 'stagedOperationCounter', args: [] })
		await assert.rejects(
			executeThroughRejectingReceiver(
				receiver,
				priceOracle,
				encodeFunctionData({
					abi: coordinatorAbi,
					functionName: 'requestPriceIfNeededAndStageOperation',
					args: [OperationType.SetCoverageCommitment, receiver, 0n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, proposedRepPerEthPrice, initialWethReport],
				}),
				costAttoEth + 1n,
			),
			/Oracle coordinator failed to return unused ETH/,
		)
		assert.strictEqual(await getPendingReportId(client, priceOracle), 0n, 'failed staged refund must roll back the pending report')
		assert.strictEqual(await client.readContract({ abi: coordinatorAbi, address: priceOracle, functionName: 'stagedOperationCounter', args: [] }), stagedCounterBefore, 'failed staged refund must roll back the staged operation')
		assert.strictEqual(await getActiveStagedOperationCount(client, priceOracle), 0n, 'failed staged refund must leave no active operation')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, receiver), wethBefore, 'failed staged refund must restore sponsor WETH')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), receiver), repBefore, 'failed staged refund must restore sponsor REP')
	})

	test('settlement callback gas arithmetic rejects values that cannot fit the advertised uint32 limit', async () => {
		const args = getOracleCoordinatorConstructorArgs()
		args[4] = 2 ** 32 - 1
		const coordinator = await deployContract(encodeOracleCoordinatorDeployData(args))
		await assert.rejects(
			client.readContract({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				address: coordinator,
				functionName: 'getSettlementCallbackGasLimit',
				args: [],
			}),
			/Callback gas exceeds uint32/,
		)
	})

	test('request pricing rejects a settler reward above uint96 without persisting request state', async () => {
		const coordinatorAbi = peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi
		const maximumSettlerReward = (1n << 96n) - 1n
		const overflowArgs = getOracleCoordinatorConstructorArgs()
		overflowArgs[3] = maximumSettlerReward
		const overflowCoordinator = await deployContract(encodeOracleCoordinatorDeployData(overflowArgs))
		const setupHash = await client.writeContract({
			abi: coordinatorAbi,
			address: overflowCoordinator,
			functionName: 'setSecurityPool',
			args: [securityPool],
		})
		await client.waitForTransactionReceipt({ hash: setupHash })

		const baseFeeAttoEthPerGas = 1n
		const requestGasUnits = 4n * (BigInt(ORACLE_SETTLEMENT_GAS) * 4n + maximumSettlerReward)
		const requestEthCost = baseFeeAttoEthPerGas * requestGasUnits + 101n
		assert.ok(requestEthCost > maximumSettlerReward, 'test setup must exceed the uint96 settler reward boundary')

		const pendingReportBefore = await getPendingReportId(client, overflowCoordinator)
		const nextReportIdBefore = await client.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: getInfraContractAddresses().openOracle,
			functionName: 'nextReportId',
			args: [],
		})
		await mockWindow.setBalance(client.account.address, requestEthCost * 3n)
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${baseFeeAttoEthPerGas.toString(16)}`],
		})
		await mockWindow.request({ method: 'evm_mine', params: [] })
		try {
			await assert.rejects(
				client.writeContract({
					abi: coordinatorAbi,
					address: overflowCoordinator,
					functionName: 'requestPrice',
					args: [1n, 0n],
					value: requestEthCost,
					gasPrice: baseFeeAttoEthPerGas,
				}),
				/Oracle settler reward exceeds uint96 maximum/,
			)
		} finally {
			await mockWindow.setNextBlockBaseFeePerGasToZero()
		}

		assert.strictEqual(await getPendingReportId(client, overflowCoordinator), pendingReportBefore, 'overflowing settler reward must not create a pending request')
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: getInfraContractAddresses().openOracle,
				functionName: 'nextReportId',
				args: [],
			}),
			nextReportIdBefore,
			'overflowing settler reward must not create an OpenOracle report',
		)
	})

	test('oracle settlement accepts the exact nonzero basefee cap and rejects one attoETH above it', async () => {
		const requestBaseFeeAttoEthPerGas = 1n * 10n ** 9n
		const expectedSettlementBaseFeeCap = (requestBaseFeeAttoEthPerGas * ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS) / 10000n
		const minimumWethReport = calculateOracleMinimumWethReportAttoEth({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			baseFeeAttoEthPerGas: requestBaseFeeAttoEthPerGas,
		})
		const callbackGasLimit = BigInt(ORACLE_SETTLEMENT_GAS) * 4n
		const requestEthCost = requestBaseFeeAttoEthPerGas * 4n * (callbackGasLimit + ORACLE_REPORT_GAS) + 101n
		const proposedRepPerEthPrice = 10n ** 18n

		await wrapWeth(client, minimumWethReport * 2n)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)

		const requestAtConfiguredBaseFee = async () => {
			await mockWindow.request({
				method: 'anvil_setNextBlockBaseFeePerGas',
				params: [`0x${requestBaseFeeAttoEthPerGas.toString(16)}`],
			})
			const requestHash = await client.writeContract({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'requestPrice',
				address: priceOracle,
				args: [proposedRepPerEthPrice, 0n],
				value: requestEthCost,
				gasPrice: requestBaseFeeAttoEthPerGas,
			})
			await client.waitForTransactionReceipt({ hash: requestHash })
			const reportId = await getPendingReportId(client, priceOracle)
			assert.ok(reportId > 0n, 'nonzero-basefee request should create a pending report')
			assert.strictEqual(await getPendingReportMaxSettlementBaseFee(client, priceOracle), expectedSettlementBaseFeeCap, 'request should snapshot the configured nonzero settlement basefee cap')
			return reportId
		}

		const acceptedReportId = await requestAtConfiguredBaseFee()
		const acceptedReportMeta = await getOpenOracleReportMeta(client, acceptedReportId)
		const initialHistoryRecord = await client.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'disputeHistory',
			address: getInfraContractAddresses().openOracle,
			args: [acceptedReportId, 0n],
		})
		assert.strictEqual(initialHistoryRecord[0], minimumWethReport, 'the initial report should equal the final-history economic floor')
		assert.strictEqual(initialHistoryRecord[2], requestBaseFeeAttoEthPerGas, 'the exact-floor check should use the initial report block base fee')
		await mockWindow.advanceTime(BigInt(acceptedReportMeta.settlementTime) + 1n)
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${expectedSettlementBaseFeeCap.toString(16)}`],
		})
		const acceptedHash = await openOracleSettleWithGasPrice(client, acceptedReportId, expectedSettlementBaseFeeCap)
		const acceptedReceipt = await client.waitForTransactionReceipt({ hash: acceptedHash })
		assert.strictEqual(findPriceReportRejectedLog(acceptedReceipt.logs), undefined, 'settlement at the exact basefee cap should not be rejected')
		assert.ok(findPriceReportedLog(acceptedReceipt.logs) !== undefined, 'settlement at the exact basefee cap should report the accepted price')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), true, 'settlement at the exact basefee cap should validate the price')

		await mockWindow.setNextBlockBaseFeePerGasToZero()
		await mockWindow.advanceTime(5n * 60n + 1n)
		const rejectedReportId = await requestAtConfiguredBaseFee()
		const rejectedReportMeta = await getOpenOracleReportMeta(client, rejectedReportId)
		await mockWindow.advanceTime(BigInt(rejectedReportMeta.settlementTime) + 1n)
		const rejectedSettlementBaseFee = expectedSettlementBaseFeeCap + 1n
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${rejectedSettlementBaseFee.toString(16)}`],
		})
		const rejectedHash = await openOracleSettleWithGasPrice(client, rejectedReportId, rejectedSettlementBaseFee)
		const rejectedReceipt = await client.waitForTransactionReceipt({ hash: rejectedHash })
		const rejectedLog = findPriceReportRejectedLog(rejectedReceipt.logs)
		if (rejectedLog === undefined) throw new Error('missing PriceReportRejected log')
		assert.strictEqual(findPriceReportedLog(rejectedReceipt.logs), undefined, 'settlement one attoETH above the basefee cap must not report a price')
		assert.strictEqual(rejectedLog.args.reason, 'Base fee too high', 'settlement one attoETH above the cap should expose the basefee rejection reason')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'settlement one attoETH above the basefee cap must leave the stale price invalid')
	})

	test('oracle settlement rejects a final report that was uneconomic to dispute at its recorded base fee', async () => {
		const requestBaseFeeAttoEthPerGas = 1n * 10n ** 9n
		const finalReportBaseFeeAttoEthPerGas = 100n * 10n ** 9n
		const proposedRepPerEthPrice = 10n ** 18n
		const requestEthCost = requestBaseFeeAttoEthPerGas * 4n * (BigInt(ORACLE_SETTLEMENT_GAS) * 4n + ORACLE_REPORT_GAS) + 101n
		const minimumWethReport = calculateOracleMinimumWethReportAttoEth({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			baseFeeAttoEthPerGas: requestBaseFeeAttoEthPerGas,
		})
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const openOracle = getInfraContractAddresses().openOracle

		await wrapWeth(client, minimumWethReport)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)
		await wrapWeth(counterpartyClient, minimumWethReport * 4n)
		await approveToken(counterpartyClient, WETH_ADDRESS, openOracle)
		await approveToken(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${requestBaseFeeAttoEthPerGas.toString(16)}`],
		})
		const requestHash = await client.writeContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPrice',
			address: priceOracle,
			args: [proposedRepPerEthPrice, 0n],
			value: requestEthCost,
			gasPrice: requestBaseFeeAttoEthPerGas,
		})
		await client.waitForTransactionReceipt({ hash: requestHash })

		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		const reportStatus = await getOpenOracleReportStatus(client, reportId)
		const reportState = (await loadOpenOracleEventState(client, reportId)).latest
		const disputedAmount1 = (reportStatus.currentAmount1 * reportMeta.multiplier) / 100n
		const disputedAmount2 = reportStatus.currentAmount2
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${finalReportBaseFeeAttoEthPerGas.toString(16)}`],
		})
		const disputeHash = await counterpartyClient.writeContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'dispute',
			address: openOracle,
			args: [reportId, disputedAmount1, disputedAmount2, counterpartyClient.account.address, false, false, getOpenOracleGameTuple(reportState.game), getOpenOracleHelperTuple(reportState.helper), [0n, 0n, 0n, 0n]],
			gasPrice: finalReportBaseFeeAttoEthPerGas,
		})
		await counterpartyClient.waitForTransactionReceipt({ hash: disputeHash })
		const finalHistoryRecord = await client.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'disputeHistory',
			address: openOracle,
			args: [reportId, 1n],
		})
		assert.strictEqual(finalHistoryRecord[2], finalReportBaseFeeAttoEthPerGas, 'OpenOracle should record the final report block base fee')

		const finalReportStatus = await getOpenOracleReportStatus(client, reportId)
		await mockWindow.setTime(finalReportStatus.reportTimestamp + reportMeta.settlementTime - 1n)
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${requestBaseFeeAttoEthPerGas.toString(16)}`],
		})
		const settlementHash = await openOracleSettleWithGasPrice(client, reportId, requestBaseFeeAttoEthPerGas)
		const settlementReceipt = await client.waitForTransactionReceipt({ hash: settlementHash })
		const rejectedLog = findPriceReportRejectedLog(settlementReceipt.logs)
		if (rejectedLog === undefined) throw new Error('missing PriceReportRejected log')
		assert.strictEqual(rejectedLog.args.reason, 'Report uneconomic')
		assert.strictEqual(findPriceReportedLog(settlementReceipt.logs), undefined, 'an uneconomic final dispute round must not publish a price')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'an uneconomic final dispute round must leave the price invalid')
	})

	test('oracle settlement reads the last of multiple dispute-history records', async () => {
		const baseFeeAttoEthPerGas = 1n * 10n ** 9n
		const finalDisputeBaseFeeAttoEthPerGas = 100n * 10n ** 9n
		const proposedRepPerEthPrice = 10n ** 18n
		const requestEthCost = baseFeeAttoEthPerGas * 4n * (BigInt(ORACLE_SETTLEMENT_GAS) * 4n + ORACLE_REPORT_GAS) + 101n
		const initialWethReport = calculateOracleMinimumWethReportAttoEth({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			baseFeeAttoEthPerGas,
		})
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const openOracle = getInfraContractAddresses().openOracle

		await wrapWeth(client, initialWethReport * 2n)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)
		await wrapWeth(counterpartyClient, initialWethReport * 4n)
		await approveToken(counterpartyClient, WETH_ADDRESS, openOracle)
		await approveToken(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${baseFeeAttoEthPerGas.toString(16)}`],
		})
		const requestHash = await client.writeContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPrice',
			address: priceOracle,
			args: [proposedRepPerEthPrice, 0n],
			value: requestEthCost,
			gasPrice: baseFeeAttoEthPerGas,
		})
		await client.waitForTransactionReceipt({ hash: requestHash })

		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		for (let disputeIndex = 1n; disputeIndex <= 2n; disputeIndex++) {
			const reportState = (await loadOpenOracleEventState(client, reportId)).latest
			const newAmount1 = (reportState.game.currentAmount1 * reportMeta.multiplier) / 100n
			const newAmount2 = (reportState.game.currentAmount2 * reportMeta.multiplier) / 100n
			const disputeBaseFeeAttoEthPerGas = disputeIndex === 2n ? finalDisputeBaseFeeAttoEthPerGas : baseFeeAttoEthPerGas
			await mockWindow.request({
				method: 'anvil_setNextBlockBaseFeePerGas',
				params: [`0x${disputeBaseFeeAttoEthPerGas.toString(16)}`],
			})
			const disputeHash = await counterpartyClient.writeContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'dispute',
				address: openOracle,
				args: [reportId, newAmount1, newAmount2, counterpartyClient.account.address, false, false, getOpenOracleGameTuple(reportState.game), getOpenOracleHelperTuple(reportState.helper), [0n, 0n, 0n, 0n]],
				gasPrice: disputeBaseFeeAttoEthPerGas,
			})
			await counterpartyClient.waitForTransactionReceipt({ hash: disputeHash })
			const historyRecord = await client.readContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'disputeHistory',
				address: openOracle,
				args: [reportId, disputeIndex],
			})
			assert.strictEqual(historyRecord[0], newAmount1, `history index ${disputeIndex} should preserve the disputed WETH amount`)
			assert.strictEqual(historyRecord[2], disputeBaseFeeAttoEthPerGas, `history index ${disputeIndex} should record its report-block base fee`)
		}

		const finalReportStatus = await getOpenOracleReportStatus(client, reportId)
		await mockWindow.setTime(finalReportStatus.reportTimestamp + reportMeta.settlementTime - 1n)
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${baseFeeAttoEthPerGas.toString(16)}`],
		})
		const settlementHash = await openOracleSettleWithGasPrice(client, reportId, baseFeeAttoEthPerGas)
		const settlementReceipt = await client.waitForTransactionReceipt({ hash: settlementHash })
		const rejectedLog = findPriceReportRejectedLog(settlementReceipt.logs)
		if (rejectedLog === undefined) throw new Error('missing PriceReportRejected log')
		assert.strictEqual(rejectedLog.args.reason, 'Report uneconomic')
		assert.strictEqual(findPriceReportedLog(settlementReceipt.logs), undefined, 'the uniquely expensive final dispute record must drive settlement rejection')
	})

	test('oracle settlement rejects a saturated dispute-history counter', async () => {
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const stagedCoverageCommitmentAttoEth = repDeposit / 4n
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, stagedCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, costAttoEth)
		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		const eventState = await loadOpenOracleEventState(client, reportId)
		const saturatedPreimage: OpenOracleStatePreimage = {
			...eventState.latest,
			game: {
				...eventState.latest.game,
				numReports: MAX_OPEN_ORACLE_REPORT_COUNT,
			},
		}
		const gameSlot = getMappingStorageSlot(reportId, OPEN_ORACLE_GAME_MAPPING_SLOT)
		await mockWindow.addStateOverrides({
			[getInfraContractAddresses().openOracle]: {
				stateDiff: {
					[formatStorageSlot(gameSlot)]: BigInt(hashOpenOracleStatePreimage(saturatedPreimage)),
				},
			},
		})

		await mockWindow.advanceTime(reportMeta.settlementTime + 1n)
		const settlementHash = await client.writeContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: getInfraContractAddresses().openOracle,
			functionName: 'settle',
			args: [reportId, getOpenOracleGameTuple(saturatedPreimage.game), getOpenOracleHelperTuple(saturatedPreimage.helper)],
		})
		const settlementReceipt = await client.waitForTransactionReceipt({ hash: settlementHash })
		const rejectedLog = findPriceReportRejectedLog(settlementReceipt.logs)
		if (rejectedLog === undefined) throw new Error('missing PriceReportRejected log')
		assert.strictEqual(rejectedLog.args.reason, 'Counter saturated', 'saturation should be distinguishable from an uneconomic final report')
		assert.strictEqual(findPriceReportedLog(settlementReceipt.logs), undefined, 'a saturated history counter must not publish a price')
		assert.strictEqual(await getPendingReportId(client, priceOracle), 0n, 'saturated settlement should clear the pending report')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'saturated settlement must leave the cached price invalid')
		assert.strictEqual(findExecutedStagedOperationLog(settlementReceipt.logs), undefined, 'saturated settlement must not execute the staged operation')
		assert.strictEqual(await getPendingOperationSlotId(client, priceOracle), 1n, 'saturated settlement should preserve the compatibility pending-operation slot')
		assert.deepStrictEqual(await getPendingSettlementOperationIds(client, priceOracle), [1n], 'saturated settlement should leave the operation queued for a later valid price path')
		assert.strictEqual(await getActiveStagedOperationCount(client, priceOracle), 1n, 'saturated settlement should leave the queued operation active')
		assert.strictEqual((await getStagedOperation(client, priceOracle, 1n))[1], client.account.address, 'saturated settlement must not consume the queued operation')
		assert.strictEqual((await getSecurityVault(client, securityPool, client.account.address)).coverageCommitmentAttoEth, 0n, 'coverage commitment')
	})

	test('oracle settlement skips price updates and staged execution when settlement basefee is too high', async () => {
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const unsafeCoverageCommitmentAttoEth = repDeposit / 4n

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, unsafeCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, costAttoEth)

		const pendingReportId = await getPendingReportId(client, priceOracle)
		const pendingMaxSettlementBaseFee = await getPendingReportMaxSettlementBaseFee(client, priceOracle)
		assert.ok(pendingReportId > 0n, 'setup should leave a pending oracle report')
		assert.strictEqual(pendingMaxSettlementBaseFee, 0n, 'zero-basefee request should only settle under zero basefee')
		const lastPriceBeforeSettlement = await getLastPrice(client, priceOracle)
		const lastSettlementTimestampBeforeSettlement = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastSettlementTimestamp',
			address: priceOracle,
			args: [],
		})

		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: ['0x1'] })
		const settlementHash = await openOracleSettleWithGasPrice(client, pendingReportId, 1n)
		const settlementReceipt = await client.waitForTransactionReceipt({ hash: settlementHash })
		await mockWindow.setNextBlockBaseFeePerGasToZero()
		await assertCoordinatorReplayMatchesStorage(settlementReceipt.logs, 'rejected report')

		const isPriceValid = await getIsPriceValid(client, priceOracle)
		const pendingReportIdAfterSettlement = await getPendingReportId(client, priceOracle)
		const pendingMaxSettlementBaseFeeAfterSettlement = await getPendingReportMaxSettlementBaseFee(client, priceOracle)
		const pendingOperationSlotId = await getPendingOperationSlotId(client, priceOracle)
		const stagedOperation = await getStagedOperation(client, priceOracle, 1n)
		const vault = await getSecurityVault(client, securityPool, client.account.address)
		const rejectedLog = findPriceReportRejectedLog(settlementReceipt.logs)
		if (rejectedLog === undefined) throw new Error('missing PriceReportRejected log')

		assert.strictEqual(isPriceValid, false, 'high-basefee settlement must not validate the price')
		assert.strictEqual(pendingReportIdAfterSettlement, 0n, 'high-basefee settlement should clear the stale pending report')
		assert.strictEqual(pendingMaxSettlementBaseFeeAfterSettlement, 0n, 'high-basefee settlement should clear the basefee guard')
		assert.strictEqual(pendingOperationSlotId, 1n, 'high-basefee settlement should leave the auto-execute slot pending for a future valid price')
		assert.strictEqual(stagedOperation[1], client.account.address, 'high-basefee settlement must not consume staged operations')
		assert.strictEqual(vault.coverageCommitmentAttoEth, 0n, 'coverage commitment')
		assert.strictEqual(rejectedLog.args.reportId, pendingReportId, 'PriceReportRejected should identify the rejected report')
		assert.strictEqual(rejectedLog.args.reason, 'Base fee too high', 'PriceReportRejected should expose the rejection reason')
		assert.strictEqual(rejectedLog.args.pendingReportId, pendingReportIdAfterSettlement, 'PriceReportRejected should expose the cleared pending report id')
		assert.strictEqual(rejectedLog.args.pendingReportMaxSettlementBaseFeeAttoEthPerGas, pendingMaxSettlementBaseFeeAfterSettlement, 'PriceReportRejected should expose the cleared basefee guard')
		assert.strictEqual(rejectedLog.args.lastPrice, lastPriceBeforeSettlement, 'PriceReportRejected should expose the unchanged last price')
		assert.strictEqual(rejectedLog.args.lastSettlementTimestamp, lastSettlementTimestampBeforeSettlement, 'PriceReportRejected should expose the unchanged settlement timestamp')

		await requestPrice(client, priceOracle)
		const recoveryPendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(recoveryPendingReportId > 0n, 'oracle state should recover after a high-basefee settlement clears the report')
	})

	test('requestPrice should refund excess Ether when overpaid', async () => {
		// Test that overpayment is refunded, not kept by contract
		const initialBalance = await getETHBalance(client, client.account.address)
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const overpayment = costAttoEth * 2n
		const minimumWethReport = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1ReportAttoEth',
			address: priceOracle,
			args: [],
		})

		// Call requestPrice with overpayment
		await requestPriceWithValue(client, priceOracle, overpayment)

		const finalBalance = await getETHBalance(client, client.account.address)

		// The helper wraps a 2x WETH execution buffer before requesting the report.
		// The unused WETH remains with the caller; any extra native ETH value should
		// still be refunded by the coordinator.
		const expectedEthDecrease = costAttoEth + minimumWethReport * 2n
		assert.strictEqual(initialBalance - finalBalance, expectedEthDecrease, `Caller should spend the ETH bounty plus the buffered WETH funding (${expectedEthDecrease}), but spent ${initialBalance - finalBalance}`)
	})

	test('requestPriceIfNeededAndStageOperation should not drain preexisting contract balance', async () => {
		// This test verifies that pre-existing ETH in the contract is not refunded to the caller
		// (drain vulnerability). It works even when price is invalid (so requestPrice is called internally).

		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const preBalance = costAttoEth * 3n // some arbitrary pre-existing balance

		// Use the abstracted method to set the contract's ETH balance
		await mockWindow.setBalance(priceOracle, preBalance)

		// Verify initial contract balance
		const balanceBefore = await getETHBalance(client, priceOracle)
		assert.strictEqual(balanceBefore, preBalance, 'Pre-set balance should be set correctly')

		// Call requestPriceIfNeededAndStageOperation with overpayment
		const caller = client.account.address
		const sendValue = costAttoEth * 2n
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.WithdrawRep, caller, 100n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, sendValue)

		// After the call, the pre-existing balance should remain intact.
		// The contract should have retained costAttoEth (to pay OpenOracle) and refunded the excess (sendValue - costAttoEth).
		// Final balance = preBalance (unchanged)
		const balanceAfter = await getETHBalance(client, priceOracle)
		assert.strictEqual(balanceAfter, preBalance, `Contract should retain preexisting balance (${preBalance}) after requestPriceIfNeededAndStageOperation, but it was drained to ${balanceAfter}`)
	})

	test('capacity and missing-game guards expose exact reasons without mutating pool or vault state', async () => {
		const shareToken = getSecurityPoolAddresses(addressString(0n), genesisUniverse, questionId, statoblastSecurityMultiplierBps).shareToken
		const tokenIds = await Promise.all(
			[0n, 1n, 2n].map(
				async outcome =>
					await client.readContract({
						abi: peripherals_tokens_ShareToken_ShareToken.abi,
						address: shareToken,
						functionName: 'getTokenId',
						args: [genesisUniverse, outcome],
					}),
			),
		)
		const readGuardState = async () => ({
			collateral: await getSettlementCollateralAttoEth(client, securityPool),
			poolEth: await getETHBalance(client, securityPool),
			shareBalances: await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareToken,
				functionName: 'balanceOfBatch',
				args: [tokenIds.map(() => client.account.address), tokenIds],
			}),
			shareSupply: await getShareTokenSupplyAttoShares(client, securityPool),
			vault: await getSecurityVault(client, securityPool, client.account.address),
		})
		const stateBefore = await readGuardState()

		await assert.rejects(
			client.writeContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: securityPool,
				functionName: 'createCompleteSet',
				args: [],
				value: 1n,
			}),
			/Over capacity/,
		)
		assert.deepStrictEqual(await readGuardState(), stateBefore, 'over-capacity mint must not retain ETH, mint shares, or change pool and vault accounting')

		await assert.rejects(
			client.writeContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: securityPool,
				functionName: 'withdrawFromEscalationGame',
				args: [1, []],
			}),
			/Game missing/,
		)
		assert.deepStrictEqual(await readGuardState(), stateBefore, 'missing-game withdrawal must preserve pool and vault state')
	})

	test('minimum vault REP and coverage commitment failures expose their exact dynamic reasons and roll back', async () => {
		const underfundedVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const repToken = addressString(GENESIS_REPUTATION_TOKEN)
		const depositAmount = 1n
		await approveToken(underfundedVaultClient, repToken, securityPool)
		const depositStateBefore = {
			poolRep: await getERC20Balance(client, repToken, securityPool),
			vault: await getSecurityVault(client, securityPool, underfundedVaultClient.account.address),
			vaultRepAttoRep: await getERC20Balance(client, repToken, underfundedVaultClient.account.address),
		}
		await assert.rejects(depositRepToVault(underfundedVaultClient, securityPool, depositAmount), /Vault REP below minimum/)
		assert.deepStrictEqual(
			{
				poolRep: await getERC20Balance(client, repToken, securityPool),
				vault: await getSecurityVault(client, securityPool, underfundedVaultClient.account.address),
				vaultRepAttoRep: await getERC20Balance(client, repToken, underfundedVaultClient.account.address),
			},
			depositStateBefore,
			'minimum-REP rejection must roll back the token transfer and vault accounting',
		)

		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const belowMinimumCoverageCommitmentAttoEth = 1n
		const vaultBefore = await getSecurityVault(client, securityPool, client.account.address)

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, belowMinimumCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, costAttoEth)

		const { settleReceipt } = await settlePendingReportWithPrice(10n ** 18n)

		const pendingOperationSlotId = await getPendingOperationSlotId(client, priceOracle)
		const stagedOperation = await getStagedOperation(client, priceOracle, 1n)
		const executionLog = findExecutedStagedOperationLog(settleReceipt.logs)
		if (executionLog === undefined) throw new Error('missing ExecutedStagedOperation log for minimum coverage commitment failure')

		assert.strictEqual(pendingOperationSlotId, 0n, 'failed auto-executed operations should clear the pending slot')
		assert.strictEqual(stagedOperation[1], zeroAddress, 'failed staged operations should be consumed after their first execution attempt')
		assert.strictEqual(stagedOperation[3], belowMinimumCoverageCommitmentAttoEth, 'failed staged operations should retain their record for auditability')
		assert.strictEqual(executionLog.args.success, false, 'minimum coverage commitment failure must be reported as unsuccessful')
		assert.strictEqual(executionLog.args.errorMessage, 'Commitment min', 'minimum coverage commitment failure must expose its exact dynamic reason')
		assert.deepStrictEqual(await getSecurityVault(client, securityPool, client.account.address), vaultBefore, 'coverage commitment')

		await assert.rejects(async () => await executeStagedOperation(client, priceOracle, 1n), /Staged operation unavailable/)
	})

	test('coverage commitment', async () => {
		const repToken = addressString(GENESIS_REPUTATION_TOKEN)
		const readFinancialState = async () => ({
			poolRep: await getERC20Balance(client, repToken, securityPool),
			totalCoverageCommitmentAttoEth: await client.readContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: securityPool,
				functionName: 'totalCoverageCommitmentAttoEth',
				args: [],
			}),
			vault: await getSecurityVault(client, securityPool, client.account.address),
			vaultRepAttoRep: await getERC20Balance(client, repToken, client.account.address),
		})

		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const overBackedCoverageCommitmentAttoEth = repDeposit
		const coverageCommitmentAttoEthStateBefore = await readFinancialState()
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, overBackedCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, costAttoEth)
		const { settleReceipt } = await settlePendingReportWithPrice(10n ** 18n)
		const coverageCommitmentAttoEthExecutionLog = findExecutedStagedOperationLog(settleReceipt.logs)
		if (coverageCommitmentAttoEthExecutionLog === undefined) throw new Error('coverage commitment')

		assert.strictEqual(coverageCommitmentAttoEthExecutionLog.args.success, false, 'coverage commitment')
		assert.strictEqual(coverageCommitmentAttoEthExecutionLog.args.errorMessage, 'Vault commitment', 'over-backed coverage commitment must expose its exact dynamic reason')
		assert.deepStrictEqual(await readFinancialState(), coverageCommitmentAttoEthStateBefore, 'coverage commitment')

		const liquidationBoundaryCoverageCommitmentAttoEth = (repDeposit * 10_000n) / statoblastSecurityMultiplierBps
		const unsafeCoverageCommitmentAttoEth = liquidationBoundaryCoverageCommitmentAttoEth + 1n
		const unsafeCoverageCommitmentAttoEthHash = await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, unsafeCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		const unsafeCoverageCommitmentAttoEthReceipt = await client.waitForTransactionReceipt({ hash: unsafeCoverageCommitmentAttoEthHash })
		const unsafeCoverageCommitmentAttoEthExecutionLog = findExecutedStagedOperationLog(unsafeCoverageCommitmentAttoEthReceipt.logs)
		if (unsafeCoverageCommitmentAttoEthExecutionLog === undefined) throw new Error('coverage commitment')

		assert.strictEqual(unsafeCoverageCommitmentAttoEthExecutionLog.args.success, false, 'coverage commitment')
		assert.strictEqual(unsafeCoverageCommitmentAttoEthExecutionLog.args.errorMessage, 'Vault commitment', 'multiplier-adjusted coverage commitment failure must expose its exact dynamic reason')
		assert.deepStrictEqual(await readFinancialState(), coverageCommitmentAttoEthStateBefore, 'coverage commitment')

		const validCoverageCommitmentAttoEth = liquidationBoundaryCoverageCommitmentAttoEth
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, validCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		assert.strictEqual((await getSecurityVault(client, securityPool, client.account.address)).coverageCommitmentAttoEth, validCoverageCommitmentAttoEth, 'coverage commitment')
		const withdrawalStateBefore = await readFinancialState()
		const withdrawalHash = await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.WithdrawRep, client.account.address, repDeposit - validCoverageCommitmentAttoEth + 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		const withdrawalReceipt = await client.waitForTransactionReceipt({ hash: withdrawalHash })
		const withdrawalExecutionLog = findExecutedStagedOperationLog(withdrawalReceipt.logs)
		if (withdrawalExecutionLog === undefined) throw new Error('missing ExecutedStagedOperation log for vault bond failure')

		assert.strictEqual(withdrawalExecutionLog.args.success, false, 'withdrawing REP below the active bond backing must fail')
		assert.strictEqual(withdrawalExecutionLog.args.errorMessage, 'Vault backing insufficient', 'under-backed withdrawal must expose its exact dynamic reason')
		assert.deepStrictEqual(await readFinancialState(), withdrawalStateBefore, 'vault bond failure must roll back REP balances and aggregate and per-vault accounting')
	})

	test('coverage commitment', async () => {
		const repToken = addressString(GENESIS_REPUTATION_TOKEN)
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const counterpartyCoverageCommitmentAttoEth = (repDeposit * 10_000n) / statoblastSecurityMultiplierBps
		const increasedPrice = 2n * 10n ** 18n

		await approveToken(counterpartyClient, repToken, securityPool)
		await depositRepToVault(counterpartyClient, securityPool, repDeposit)
		await manipulatePriceOracleAndPerformOperation(counterpartyClient, mockWindow, priceOracle, OperationType.SetCoverageCommitment, counterpartyClient.account.address, counterpartyCoverageCommitmentAttoEth)
		await manipulatePriceOracle(client, mockWindow, priceOracle, increasedPrice)

		const guardedVaults = [client.account.address, counterpartyClient.account.address]
		const stateBefore = await readPoolGuardState(guardedVaults)
		const locallyBackedCoverageCommitmentAttoEth = repDeposit / 10n
		const updateHash = await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, locallyBackedCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		const updateReceipt = await client.waitForTransactionReceipt({ hash: updateHash })
		const executionLog = findExecutedStagedOperationLog(updateReceipt.logs)
		if (executionLog === undefined) throw new Error('coverage commitment')

		assert.strictEqual(await getLastPrice(client, priceOracle), increasedPrice, 'the aggregate guard must use the increased REP price')
		assert.strictEqual(executionLog.args.success, false, 'coverage commitment')
		assert.strictEqual(executionLog.args.errorMessage, 'Pool commitment', 'aggregate coverage commitment failure must expose its exact dynamic reason')
		assert.deepStrictEqual(await readPoolGuardState(guardedVaults), stateBefore, 'coverage commitment')
	})

	test('aggregate withdrawal bond guard rejects an unencumbered vault after another vault becomes under-backed', async () => {
		const repToken = addressString(GENESIS_REPUTATION_TOKEN)
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const counterpartyCoverageCommitmentAttoEth = (repDeposit * 10_000n) / statoblastSecurityMultiplierBps
		const increasedPrice = 4n * 10n ** 18n

		await approveToken(counterpartyClient, repToken, securityPool)
		await depositRepToVault(counterpartyClient, securityPool, repDeposit)
		await manipulatePriceOracleAndPerformOperation(counterpartyClient, mockWindow, priceOracle, OperationType.SetCoverageCommitment, counterpartyClient.account.address, counterpartyCoverageCommitmentAttoEth)
		await manipulatePriceOracle(client, mockWindow, priceOracle, increasedPrice)

		const guardedVaults = [client.account.address, counterpartyClient.account.address]
		const stateBefore = await readPoolGuardState(guardedVaults)
		const withdrawalAmount = repDeposit / 4n
		const withdrawalHash = await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.WithdrawRep, client.account.address, withdrawalAmount, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		const withdrawalReceipt = await client.waitForTransactionReceipt({ hash: withdrawalHash })
		const executionLog = findExecutedStagedOperationLog(withdrawalReceipt.logs)
		if (executionLog === undefined) throw new Error('missing ExecutedStagedOperation log for aggregate withdrawal failure')

		assert.strictEqual(await getLastPrice(client, priceOracle), increasedPrice, 'the aggregate guard must use the increased REP price')
		assert.strictEqual(executionLog.args.success, false, 'an unencumbered vault withdrawal must fail when aggregate pool backing is insufficient')
		assert.strictEqual(executionLog.args.errorMessage, 'Unknown error', 'aggregate withdrawal failure must expose the compact data-free pool guard')
		assert.deepStrictEqual(await readPoolGuardState(guardedVaults), stateBefore, 'aggregate withdrawal failure must roll back both vaults, complete pool accounting, backingUnits, and REP balances')
	})

	test('escalation deposit local bond failure rolls back game deployment and escrow accounting', async () => {
		const repToken = addressString(GENESIS_REPUTATION_TOKEN)
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const callerCoverageCommitmentAttoEth = (repDeposit * 10_000n) / statoblastSecurityMultiplierBps
		const escrowAmount = (repDeposit * 3n) / 5n

		await approveToken(counterpartyClient, repToken, securityPool)
		await depositRepToVault(counterpartyClient, securityPool, repDeposit)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, priceOracle, OperationType.SetCoverageCommitment, client.account.address, callerCoverageCommitmentAttoEth)
		await mockWindow.setTime(questionEndDate + 1n)
		await manipulatePriceOracle(client, mockWindow, priceOracle)

		const guardedVaults = [client.account.address, counterpartyClient.account.address]
		const stateBefore = await readPoolGuardState(guardedVaults)
		assert.strictEqual(stateBefore.escalationGame, zeroAddress, 'the local bond failure must exercise first-deposit game deployment')

		await assert.rejects(depositToEscalationGame(client, securityPool, QuestionOutcome.Yes, escrowAmount), /Vault backing insufficient/)
		assert.deepStrictEqual(await readPoolGuardState(guardedVaults), stateBefore, 'local bond failure must roll back game deployment, both vaults, pool accounting, backingUnits, REP, and escrow')
	})

	test('escalation deposit aggregate bond failure rolls back game deployment and escrow accounting', async () => {
		const repToken = addressString(GENESIS_REPUTATION_TOKEN)
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const counterpartyCoverageCommitmentAttoEth = (repDeposit * 10_000n) / statoblastSecurityMultiplierBps
		const increasedPrice = 4n * 10n ** 18n
		const escrowAmount = repDeposit / 4n

		await approveToken(counterpartyClient, repToken, securityPool)
		await depositRepToVault(counterpartyClient, securityPool, repDeposit)
		await manipulatePriceOracleAndPerformOperation(counterpartyClient, mockWindow, priceOracle, OperationType.SetCoverageCommitment, counterpartyClient.account.address, counterpartyCoverageCommitmentAttoEth)
		await mockWindow.setTime(questionEndDate + 1n)
		await manipulatePriceOracle(client, mockWindow, priceOracle, increasedPrice)

		const guardedVaults = [client.account.address, counterpartyClient.account.address]
		const stateBefore = await readPoolGuardState(guardedVaults)
		assert.strictEqual(stateBefore.escalationGame, zeroAddress, 'the aggregate bond failure must exercise first-deposit game deployment')

		await assert.rejects(depositToEscalationGame(client, securityPool, QuestionOutcome.Yes, escrowAmount), /execution reverted/)
		assert.deepStrictEqual(await readPoolGuardState(guardedVaults), stateBefore, 'aggregate bond failure must roll back game deployment, both vaults, pool accounting, backingUnits, REP, and escrow')
	})

	test('escalation deposit minimum REP failure rolls back game deployment and escrow accounting', async () => {
		const remainingDust = 9n * 10n ** 18n
		const escrowAmount = repDeposit - remainingDust
		await mockWindow.setTime(questionEndDate + 1n)

		const guardedVaults = [client.account.address]
		const stateBefore = await readPoolGuardState(guardedVaults)
		assert.strictEqual(stateBefore.escalationGame, zeroAddress, 'the minimum REP failure must exercise first-deposit game deployment')

		await assert.rejects(depositToEscalationGame(client, securityPool, QuestionOutcome.Yes, escrowAmount), /Vault REP below minimum/)
		assert.deepStrictEqual(await readPoolGuardState(guardedVaults), stateBefore, 'minimum REP failure must roll back game deployment, vault and pool accounting, backingUnits, REP, and escrow')
	})

	test('rejecting complete-set redeemer exposes ETH failed and restores every accounting mutation', async () => {
		const coverageCommitmentAttoEth = 2n * 10n ** 18n
		const collateral = 1n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, priceOracle, OperationType.SetCoverageCommitment, client.account.address, coverageCommitmentAttoEth)
		const receiver = await deployContract(
			encodeDeployData({
				abi: rejectingEthReceiverArtifact.abi,
				bytecode: `0x${rejectingEthReceiverArtifact.evm.bytecode.object}`,
			}),
		)
		const shareToken = getSecurityPoolAddresses(addressString(0n), genesisUniverse, questionId, statoblastSecurityMultiplierBps).shareToken
		await executeThroughRejectingReceiver(
			receiver,
			securityPool,
			encodeFunctionData({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'createCompleteSet',
				args: [],
			}),
			collateral,
		)
		const tokenIds = await Promise.all(
			[0n, 1n, 2n].map(
				async outcome =>
					await client.readContract({
						abi: peripherals_tokens_ShareToken_ShareToken.abi,
						address: shareToken,
						functionName: 'getTokenId',
						args: [genesisUniverse, outcome],
					}),
			),
		)
		const readRedemptionState = async () => ({
			collateral: await getSettlementCollateralAttoEth(client, securityPool),
			feeLiabilities: await getTotalClaimableVaultFeesAttoEth(client, securityPool),
			poolEth: await getETHBalance(client, securityPool),
			receiverShares: await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareToken,
				functionName: 'balanceOfBatch',
				args: [tokenIds.map(() => receiver), tokenIds],
			}),
			shareSupply: await getShareTokenSupplyAttoShares(client, securityPool),
			totalFeeLiabilities: await getTotalAccruedFees(client, securityPool),
		})
		const stateBefore = await readRedemptionState()
		assert.deepStrictEqual(stateBefore.receiverShares, [collateral * 10n ** 18n, collateral * 10n ** 18n, collateral * 10n ** 18n], 'rejecting receiver must hold one complete set before redemption')

		await assert.rejects(
			executeThroughRejectingReceiver(
				receiver,
				securityPool,
				encodeFunctionData({
					abi: peripherals_SecurityPool_SecurityPool.abi,
					functionName: 'redeemCompleteSet',
					args: [collateral * 10n ** 18n],
				}),
			),
			/ETH failed/,
		)
		assert.deepStrictEqual(await readRedemptionState(), stateBefore, 'failed redemption payout must restore shares, supply, collateral, fee liabilities, and pool ETH')
	})

	test('only the pending report sponsor can queue more operations while settlement is pending', async () => {
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const sponsorCoverageCommitmentAttoEth = repDeposit / 4n
		const counterpartyCoverageCommitmentAttoEth = repDeposit / 5n

		await approveToken(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRepToVault(counterpartyClient, securityPool, repDeposit)

		const sponsorRequestHash = await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, sponsorCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, costAttoEth)
		const sponsorRequestReceipt = await client.waitForTransactionReceipt({ hash: sponsorRequestHash })
		await assertCoordinatorReplayMatchesStorage(sponsorRequestReceipt.logs, 'sponsored report request')

		const pendingReportIdBeforeJoin = await getPendingReportId(client, priceOracle)
		const queuedOperationCostAttoEth = await getQueuedOperationCostAttoEth(client, priceOracle)
		const zeroCostJoinRejected = await counterpartyClient
			.simulateContract({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'requestPriceIfNeededAndStageOperation',
				address: priceOracle,
				args: [OperationType.SetCoverageCommitment, counterpartyClient.account.address, counterpartyCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 1n, 0n],
				account: counterpartyClient.account,
			})
			.then(
				() => false,
				error => {
					if (!(error instanceof Error)) throw error
					return error.message.includes('Only the pending report sponsor can queue more operations until settlement')
				},
			)

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, counterpartyCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, queuedOperationCostAttoEth)

		const pendingReportIdAfterJoin = await getPendingReportId(client, priceOracle)

		assert.strictEqual(queuedOperationCostAttoEth, 0n, 'queued operation joins should no longer charge an ETH fee')
		assert.strictEqual(pendingReportIdAfterJoin, pendingReportIdBeforeJoin, 'the sponsor should reuse the existing oracle request')
		assert.strictEqual(zeroCostJoinRejected, true, 'non-sponsors should be rejected while a pending oracle settlement is in flight')
		assert.strictEqual((await getPendingSettlementOperationIds(client, priceOracle)).length, 2, 'the sponsor should still be able to queue additional pending operations without paying a join fee')
	})

	test('rolling OpenOracle disputes extend sponsor exclusivity without corrupting the pending operation queue', async () => {
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const sponsorCoverageCommitmentAttoEth = repDeposit / 4n
		const sponsorCoverageCommitmentAttoEthAfterDispute = repDeposit / 5n
		await approveToken(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRepToVault(counterpartyClient, securityPool, repDeposit)
		await requestPriceIfNeededAndStageOperationWithInitialReportPrice(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, sponsorCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 10n ** 18n, costAttoEth, 1000n)

		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		const reportStatusBeforeDispute = await getOpenOracleReportStatus(client, reportId)
		const extraDataBeforeDispute = await getOpenOracleExtraData(client, reportId)
		const preimageBeforeDispute = (await loadOpenOracleEventState(client, reportId)).latest
		const openOracle = getInfraContractAddresses().openOracle
		const sponsorRepBalanceAfterRequest = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		const sponsorWethBalanceAttoEthAfterRequest = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
		const disputedAmount1 = (reportStatusBeforeDispute.currentAmount1 * reportMeta.multiplier) / 100n
		const disputedAmount2 = reportStatusBeforeDispute.currentAmount2 * 2n
		const disputeFee = (reportStatusBeforeDispute.currentAmount2 * reportMeta.feePercentage) / 10_000_000n
		const disputeProtocolFee = (reportStatusBeforeDispute.currentAmount2 * reportMeta.protocolFee) / 10_000_000n
		const sponsorRepPayout = 2n * reportStatusBeforeDispute.currentAmount2 + disputeFee
		await wrapWeth(counterpartyClient, reportStatusBeforeDispute.currentAmount1 * 3n)
		await approveToken(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
		await approveToken(counterpartyClient, WETH_ADDRESS, openOracle)
		const counterpartyRepBalanceBeforeDispute = await getERC20Balance(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), counterpartyClient.account.address)
		const counterpartyWethBalanceAttoEthBeforeDispute = await getERC20Balance(counterpartyClient, WETH_ADDRESS, counterpartyClient.account.address)
		const disputeHash = await counterpartyClient.writeContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'dispute',
			address: openOracle,
			args: [reportId, disputedAmount1, disputedAmount2, counterpartyClient.account.address, false, false, getOpenOracleGameTuple(preimageBeforeDispute.game), getOpenOracleHelperTuple(preimageBeforeDispute.helper), [0n, 0n, 0n, 0n]],
		})
		await counterpartyClient.waitForTransactionReceipt({ hash: disputeHash })

		const reportStatusAfterDispute = await getOpenOracleReportStatus(client, reportId)
		assert.strictEqual(reportStatusAfterDispute.currentReporter, counterpartyClient.account.address, 'the disputer should become the current reporter')
		assert.strictEqual(reportStatusAfterDispute.currentAmount1, disputedAmount1, 'the disputed WETH amount should become current')
		assert.strictEqual(reportStatusAfterDispute.currentAmount2, disputedAmount2, 'the disputed REP amount should become current')
		assert.ok(reportStatusAfterDispute.reportTimestamp > reportStatusBeforeDispute.reportTimestamp, 'a dispute should reset the settlement clock')
		assert.strictEqual((await getOpenOracleExtraData(client, reportId)).numReports, extraDataBeforeDispute.numReports + 1, 'the dispute should append exactly one history entry')
		assert.strictEqual(await getPendingReportId(client, priceOracle), reportId, 'the coordinator should keep tracking the disputed report')
		assert.deepStrictEqual(await getPendingSettlementOperationIds(client, priceOracle), [1n], 'the sponsor queue should remain unchanged by a dispute')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, addressString(GENESIS_REPUTATION_TOKEN)), sponsorRepPayout + 1n, 'the coordinator should hold the sponsor REP payout until settlement callback')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, WETH_ADDRESS), 1n, 'the disputed sponsor WETH slot should retain only its sentinel')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), sponsorRepBalanceAfterRequest, 'the sponsor payout should remain internal until settlement callback')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), sponsorWethBalanceAttoEthAfterRequest, 'the sponsor should not receive WETH when the disputer swaps REP')
		assert.strictEqual(
			await getERC20Balance(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), counterpartyClient.account.address),
			counterpartyRepBalanceBeforeDispute - disputedAmount2 - reportStatusBeforeDispute.currentAmount2 - disputeFee - disputeProtocolFee,
			'the disputer should fund the replacement REP, swap principal, reporter fee, and protocol fee exactly',
		)
		assert.strictEqual(await getERC20Balance(counterpartyClient, WETH_ADDRESS, counterpartyClient.account.address), counterpartyWethBalanceAttoEthBeforeDispute - (disputedAmount1 - reportStatusBeforeDispute.currentAmount1), 'the disputer should fund only the incremental WETH collateral before settlement')
		assert.strictEqual(await getOpenOracleHeldBalance(client, counterpartyClient.account.address, addressString(GENESIS_REPUTATION_TOKEN)), 1n, 'the disputer REP slot should contain only its sentinel before settlement')
		assert.strictEqual(await getOpenOracleHeldBalance(client, counterpartyClient.account.address, WETH_ADDRESS), 1n, 'the disputer WETH slot should contain only its sentinel before settlement')

		await assert.rejects(
			counterpartyClient.simulateContract({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'requestPriceIfNeededAndStageOperation',
				address: priceOracle,
				args: [OperationType.SetCoverageCommitment, counterpartyClient.account.address, repDeposit / 6n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 1n, 0n],
				account: counterpartyClient.account,
			}),
			/Only the pending report sponsor can queue more operations until settlement/,
		)
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, sponsorCoverageCommitmentAttoEthAfterDispute, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		assert.deepStrictEqual(await getPendingSettlementOperationIds(client, priceOracle), [1n, 2n], 'the original sponsor should retain queue append rights after a dispute')

		await mockWindow.setTime(reportStatusAfterDispute.reportTimestamp + reportMeta.settlementTime - 1n)
		await openOracleSettle(client, reportId)
		assert.strictEqual(await getPendingReportId(client, priceOracle), 0n, 'settlement should clear the disputed pending report')
		assert.deepStrictEqual(await getPendingSettlementOperationIds(client, priceOracle), [], 'settlement should consume the undamaged pending queue')
		assert.strictEqual((await getSecurityVault(client, securityPool, client.account.address)).coverageCommitmentAttoEth, sponsorCoverageCommitmentAttoEthAfterDispute, 'queued sponsor operations should execute in order after the final settlement')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), sponsorRepBalanceAfterRequest + sponsorRepPayout, 'settlement callback should pay the dispute proceeds to the original sponsor')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), sponsorWethBalanceAttoEthAfterRequest, 'settlement callback should not invent a sponsor WETH payout')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, addressString(GENESIS_REPUTATION_TOKEN)), 1n, 'settlement callback should drain the coordinator REP credit to its sentinel')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, WETH_ADDRESS), 1n, 'settlement callback should leave the coordinator WETH sentinel intact')
		assert.strictEqual(await getOpenOracleHeldBalance(client, counterpartyClient.account.address, addressString(GENESIS_REPUTATION_TOKEN)), disputedAmount2 + 1n, 'settlement should credit the final REP backing to the disputer')
		assert.strictEqual(await getOpenOracleHeldBalance(client, counterpartyClient.account.address, WETH_ADDRESS), disputedAmount1 + 1n, 'settlement should credit the final WETH collateral to the disputer')
	})

	test('only the pending report sponsor can queue overflow operations while settlement is pending', async () => {
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const queuedOperationCostAttoEth = await getQueuedOperationCostAttoEth(client, priceOracle)

		await approveToken(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRepToVault(counterpartyClient, securityPool, repDeposit)
		await fillPendingSettlementOperationList(costAttoEth, queuedOperationCostAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS)

		const overflowRejected = await counterpartyClient
			.simulateContract({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'requestPriceIfNeededAndStageOperation',
				address: priceOracle,
				args: [OperationType.SetCoverageCommitment, counterpartyClient.account.address, repDeposit / 5n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 1n, 0n],
				account: counterpartyClient.account,
			})
			.then(
				() => false,
				error => {
					if (!(error instanceof Error)) throw error
					return error.message.includes('Only the pending report sponsor can queue more operations until settlement')
				},
			)

		assert.strictEqual(overflowRejected, true, 'non-sponsors should not be able to add overflow staged operations while a pending report exists')
	})

	test('requestPrice rejects new requests while the cached price is still valid', async () => {
		await requestPrice(client, priceOracle)
		await settlePendingReportWithPrice(10n ** 18n)
		assert.strictEqual(await getIsPriceValid(client, priceOracle), true, 'test setup should seed a fresh cached oracle price')

		await assert.rejects(async () => await requestPrice(client, priceOracle), /Oracle price already fresh/i)
	})

	test('expired pending auto-execute slots do not block later valid oracle settlements', async () => {
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const unsafeCoverageCommitmentAttoEth = repDeposit * 10n

		await requestPriceIfNeededAndStageOperationWithInitialReportPrice(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, unsafeCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 10n ** 18n, costAttoEth)

		const pendingReportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS + 1n)
		await openOracleSettle(client, pendingReportId)

		const isPriceValid = await getIsPriceValid(client, priceOracle)
		const pendingOperationSlotId = await getPendingOperationSlotId(client, priceOracle)
		const stagedOperation = await getStagedOperation(client, priceOracle, 1n)
		const vault = await getSecurityVault(client, securityPool, client.account.address)

		assert.strictEqual(isPriceValid, true, 'a valid report should settle even when its pending auto-execute slot expired')
		assert.strictEqual(pendingOperationSlotId, 0n, 'expired pending auto-execute slots should be cleared during callback')
		assert.strictEqual(stagedOperation[1], zeroAddress, 'expired pending auto-execute operations should be consumed')
		assert.strictEqual(vault.coverageCommitmentAttoEth, 0n, 'expired pending operations must not execute during later valid settlement')
	})

	test('failed OpenOracle settlement callbacks do not leave the coordinator permanently pending', async () => {
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		await requestPriceWithValue(client, priceOracle, costAttoEth)

		const pendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(pendingReportId > 0n, 'setup should leave a pending oracle report')
		const pendingState = (await loadOpenOracleEventState(client, pendingReportId)).latest
		const sponsorRepBalanceAfterRequest = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		const sponsorWethBalanceAttoEthAfterRequest = await getERC20Balance(client, WETH_ADDRESS, client.account.address)

		await settlePendingReportWithFailedCallback(pendingReportId)

		const pendingReportIdAfterSettlement = await getPendingReportId(client, priceOracle)
		assert.strictEqual(pendingReportIdAfterSettlement, pendingReportId, 'failed callbacks should leave recovery work to the coordinator recovery function')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), sponsorRepBalanceAfterRequest, 'failed callback settlement should not return REP before recovery')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), sponsorWethBalanceAttoEthAfterRequest, 'failed callback settlement should not return WETH before recovery')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, addressString(GENESIS_REPUTATION_TOKEN)), pendingState.game.currentAmount2 + 1n, 'failed callback settlement should credit the coordinator REP balance')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, WETH_ADDRESS), pendingState.game.currentAmount1 + 1n, 'failed callback settlement should credit the coordinator WETH balance')

		const recoveryHash = await recoverSettledPendingReport(client, priceOracle)
		const recoveryReceipt = await client.waitForTransactionReceipt({ hash: recoveryHash })
		await assertCoordinatorReplayMatchesStorage(recoveryReceipt.logs, 'pending report recovery')

		const pendingReportIdAfterRecovery = await getPendingReportId(client, priceOracle)
		const pendingMaxSettlementBaseFeeAfterRecovery = await getPendingReportMaxSettlementBaseFee(client, priceOracle)
		const lastPriceAfterRecovery = await getLastPrice(client, priceOracle)
		const lastSettlementTimestampAfterRecovery = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastSettlementTimestamp',
			address: priceOracle,
			args: [],
		})
		const recoveryLog = findPendingReportRecoveredLog(recoveryReceipt.logs)
		if (recoveryLog === undefined) throw new Error('missing PendingReportRecovered log')

		assert.strictEqual(pendingReportIdAfterRecovery, 0n, 'recovery should clear settled reports whose callback failed')
		assert.strictEqual(pendingMaxSettlementBaseFeeAfterRecovery, 0n, 'recovery should clear the stale basefee guard')
		assert.strictEqual(recoveryLog.args.reportId, pendingReportId, 'PendingReportRecovered should identify the recovered report')
		assert.strictEqual(recoveryLog.args.pendingReportId, pendingReportIdAfterRecovery, 'PendingReportRecovered should expose the cleared pending report id')
		assert.strictEqual(recoveryLog.args.pendingReportMaxSettlementBaseFeeAttoEthPerGas, pendingMaxSettlementBaseFeeAfterRecovery, 'PendingReportRecovered should expose the cleared basefee guard')
		assert.strictEqual(recoveryLog.args.lastPrice, lastPriceAfterRecovery, 'PendingReportRecovered should expose the unchanged last price')
		assert.strictEqual(recoveryLog.args.lastSettlementTimestamp, lastSettlementTimestampAfterRecovery, 'PendingReportRecovered should expose the unchanged settlement timestamp')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), sponsorRepBalanceAfterRequest + pendingState.game.currentAmount2, 'recovery should return the settled REP amount to the sponsor')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), sponsorWethBalanceAttoEthAfterRequest + pendingState.game.currentAmount1, 'recovery should return the settled WETH amount to the sponsor')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, addressString(GENESIS_REPUTATION_TOKEN)), 1n, 'recovery should drain the coordinator REP credit to its sentinel')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, WETH_ADDRESS), 1n, 'recovery should drain the coordinator WETH credit to its sentinel')

		await requestPriceWithValue(client, priceOracle, costAttoEth)
		const nextPendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(nextPendingReportId > pendingReportId, 'recovery should allow creating a fresh oracle report')
	})

	test('pending report recovery rejects unsettled reports', async () => {
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		await requestPriceWithValue(client, priceOracle, costAttoEth)

		await assert.rejects(recoverSettledPendingReport(client, priceOracle), /Pending oracle report has not settled/)
	})

	test('failed callback recovery clears the auto-execute slot so staged operations can request a fresh report', async () => {
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const firstCoverageCommitmentAttoEth = repDeposit / 4n
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, firstCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, costAttoEth)

		const pendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(pendingReportId > 0n, 'setup should leave a pending oracle report')

		await settlePendingReportWithFailedCallback(pendingReportId)

		const pendingOperationSlotIdAfterSettlement = await getPendingOperationSlotId(client, priceOracle)
		assert.strictEqual(pendingOperationSlotIdAfterSettlement, 1n, 'failed callbacks should leave the original operation in the auto-execute slot until recovery')

		const recoveryHash = await recoverSettledPendingReport(client, priceOracle)
		const recoveryReceipt = await client.waitForTransactionReceipt({ hash: recoveryHash })

		const pendingReportIdAfterRecovery = await getPendingReportId(client, priceOracle)
		const pendingOperationSlotIdAfterRecovery = await getPendingOperationSlotId(client, priceOracle)
		const recoveredStagedOperation = await getStagedOperation(client, priceOracle, 1n)
		const vault = await getSecurityVault(client, securityPool, client.account.address)

		assert.strictEqual(pendingReportIdAfterRecovery, 0n, 'recovery should clear the failed report')
		assert.strictEqual(pendingOperationSlotIdAfterRecovery, 0n, 'recovery should clear the stale auto-execute slot')
		assert.strictEqual(recoveredStagedOperation[1], zeroAddress, 'recovery should consume the operation whose callback could not complete')
		assert.strictEqual(vault.coverageCommitmentAttoEth, 0n, 'coverage commitment')
		const recoveryLog = findPendingReportRecoveredLog(recoveryReceipt.logs)
		if (recoveryLog === undefined) throw new Error('missing PendingReportRecovered log')
		assert.strictEqual(recoveryLog.args.reportId, pendingReportId, 'PendingReportRecovered should identify the recovered report')
		assert.strictEqual(recoveryLog.args.pendingReportId, pendingReportIdAfterRecovery, 'PendingReportRecovered should expose the cleared pending report id')
		assert.strictEqual(recoveryLog.args.pendingReportMaxSettlementBaseFeeAttoEthPerGas, 0n, 'PendingReportRecovered should expose the cleared basefee guard')
		const recoveryConsumedLog = findPendingOperationRecoveryConsumedLog(recoveryReceipt.logs)
		assert.strictEqual(recoveryConsumedLog?.args.operationId, 1n, 'recovery should emit the consumed operation id')
		assert.strictEqual(recoveryConsumedLog?.args.operation, BigInt(OperationType.SetCoverageCommitment), 'recovery should emit the consumed operation type')

		const secondCoverageCommitmentAttoEth = repDeposit / 5n
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, secondCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, costAttoEth)
		const nextPendingReportId = await getPendingReportId(client, priceOracle)
		const nextPendingOperationSlotId = await getPendingOperationSlotId(client, priceOracle)

		assert.ok(nextPendingReportId > pendingReportId, 'a new staged operation should be able to fund a fresh report after recovery')
		assert.strictEqual(nextPendingOperationSlotId, 2n, 'the new staged operation should become the next auto-execute slot')
	})

	test('settlement auto-executes a bounded pending operation list and leaves overflow manual', async () => {
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const queuedOperationCostAttoEth = await getQueuedOperationCostAttoEth(client, priceOracle)
		const firstCoverageCommitmentAttoEth = repDeposit / 4n
		const secondCoverageCommitmentAttoEth = repDeposit / 5n
		const thirdCoverageCommitmentAttoEth = repDeposit / 6n
		const fourthCoverageCommitmentAttoEth = repDeposit / 7n
		const fifthCoverageCommitmentAttoEth = repDeposit / 8n
		const queuedOperationLogs: TransactionReceiptLogs[number][] = []
		const queueOperation = async (coverageCommitmentAttoEth: bigint, value: bigint) => {
			const transactionHash = await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, coverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, value)
			const receipt = await client.getTransactionReceipt({ hash: transactionHash })
			queuedOperationLogs.push(...receipt.logs)
		}

		await queueOperation(firstCoverageCommitmentAttoEth, costAttoEth)
		await queueOperation(secondCoverageCommitmentAttoEth, queuedOperationCostAttoEth)
		await queueOperation(thirdCoverageCommitmentAttoEth, queuedOperationCostAttoEth)
		await queueOperation(fourthCoverageCommitmentAttoEth, queuedOperationCostAttoEth)
		await queueOperation(fifthCoverageCommitmentAttoEth, 0n)

		const pendingOperationSlotId = await getPendingOperationSlotId(client, priceOracle)
		const pendingReportId = await getPendingReportId(client, priceOracle)
		const pendingReportExtraData = await getOpenOracleExtraData(client, pendingReportId)
		const pendingSettlementOperationCount = await getPendingSettlementOperationCount(client, priceOracle)
		const pendingSettlementOperationIds = await getPendingSettlementOperationIds(client, priceOracle)
		const activeStagedOperationCount = await getActiveStagedOperationCount(client, priceOracle)
		const [operationIds, activeOperations] = await getActiveStagedOperations(client, priceOracle, 0n, 5n)
		assert.strictEqual(pendingOperationSlotId, 1n, 'first queued self operation should remain the compatibility pending slot')
		assert.strictEqual(pendingReportExtraData.callbackGasLimit, ORACLE_SETTLEMENT_GAS * 4, 'oracle report callback gas should cover the full pending settlement list')
		assert.strictEqual(pendingSettlementOperationCount, 4n, 'pending settlement operation count should cap the auto-execute list')
		assert.deepStrictEqual(Array.from(pendingSettlementOperationIds), [1n, 2n, 3n, 4n], 'pending settlement operations should stay in queue order')
		assert.strictEqual(activeStagedOperationCount, 5n, 'active staged operation count should track pending and manual operations')
		assert.deepStrictEqual(Array.from(operationIds), [5n, 4n, 3n, 2n, 1n], 'active staged operations should enumerate newest queued operations first')
		assert.strictEqual(activeOperations[0]?.operationAmountAttoRepOrAttoEth, fifthCoverageCommitmentAttoEth, 'newest overflow operation should retain its amount')
		assert.strictEqual(activeOperations[1]?.operationAmountAttoRepOrAttoEth, fourthCoverageCommitmentAttoEth, 'newest pending operation should retain its amount')
		assert.strictEqual(activeOperations[2]?.operationAmountAttoRepOrAttoEth, thirdCoverageCommitmentAttoEth, 'middle pending operation should retain its amount')
		assert.strictEqual(activeOperations[3]?.operationAmountAttoRepOrAttoEth, secondCoverageCommitmentAttoEth, 'older pending operation should retain its amount')
		assert.strictEqual(activeOperations[4]?.operationAmountAttoRepOrAttoEth, firstCoverageCommitmentAttoEth, 'oldest pending operation should retain its amount')

		const { pendingReportId: settledReportId, settleReceipt } = await settlePendingReportWithPrice(10n ** 18n)
		await assertCoordinatorReplayMatchesStorage([...queuedOperationLogs, ...settleReceipt.logs], 'reported price and staged execution')
		const priceReportedLog = findPriceReportedLog(settleReceipt.logs)
		if (priceReportedLog === undefined) throw new Error('missing PriceReported log')
		const lastPrice = await getLastPrice(client, priceOracle)
		const lastSettlementTimestamp = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastSettlementTimestamp',
			address: priceOracle,
			args: [],
		})
		assert.strictEqual(settledReportId, pendingReportId, 'settled report should match the pending report')
		assert.strictEqual(priceReportedLog.args.reportId, settledReportId, 'PriceReported should identify the settled report')
		assert.strictEqual(priceReportedLog.args.price, lastPrice, 'PriceReported should expose the updated price')
		assert.strictEqual(priceReportedLog.args.lastSettlementTimestamp, lastSettlementTimestamp, 'PriceReported should expose the updated settlement timestamp')
		const pendingOperationSlotIdAfterSettlement = await getPendingOperationSlotId(client, priceOracle)
		const pendingSettlementOperationCountAfterSettlement = await getPendingSettlementOperationCount(client, priceOracle)
		const updatedActiveStagedOperationCount = await getActiveStagedOperationCount(client, priceOracle)
		const [remainingOperationIds, remainingOperations] = await getActiveStagedOperations(client, priceOracle, 0n, 5n)

		const stagedOperation1 = await getStagedOperation(client, priceOracle, 1n)
		const stagedOperation2 = await getStagedOperation(client, priceOracle, 2n)
		const stagedOperation3 = await getStagedOperation(client, priceOracle, 3n)
		const stagedOperation4 = await getStagedOperation(client, priceOracle, 4n)
		const stagedOperation5 = await getStagedOperation(client, priceOracle, 5n)
		const vaultAfterSettlement = await getSecurityVault(client, securityPool, client.account.address)
		assert.strictEqual(pendingOperationSlotIdAfterSettlement, 0n, 'settlement should clear the compatibility pending slot after auto-executing pending operations')
		assert.strictEqual(pendingSettlementOperationCountAfterSettlement, 0n, 'settlement should clear the pending operation list after auto-execution')
		assert.strictEqual(stagedOperation1[1], zeroAddress, 'first pending operation should be consumed after oracle settlement')
		assert.strictEqual(stagedOperation2[1], zeroAddress, 'second pending operation should be consumed after oracle settlement')
		assert.strictEqual(stagedOperation3[1], zeroAddress, 'third pending operation should be consumed after oracle settlement')
		assert.strictEqual(stagedOperation4[1], zeroAddress, 'fourth pending operation should be consumed after oracle settlement')
		assert.strictEqual(stagedOperation5[1], client.account.address, 'overflow operation should remain staged for manual execution')
		assert.strictEqual(stagedOperation5[3], fifthCoverageCommitmentAttoEth, 'overflow operation should retain its requested amount until manual execution')
		assert.strictEqual(vaultAfterSettlement.coverageCommitmentAttoEth, fourthCoverageCommitmentAttoEth, 'pending settlement operations should execute in queue order')
		assert.strictEqual(updatedActiveStagedOperationCount, 1n, 'active staged operation count should leave only the overflow operation')
		assert.deepStrictEqual(Array.from(remainingOperationIds), [5n], 'active staged operations should keep the overflow operation active')
		assert.strictEqual(remainingOperations[0]?.operationAmountAttoRepOrAttoEth, fifthCoverageCommitmentAttoEth, 'overflow operation should stay in the active preview')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), true, 'settlement should leave a fresh price available for manual overflow execution')

		await executeStagedOperation(client, priceOracle, 5n)
		const finalActiveStagedOperationCount = await getActiveStagedOperationCount(client, priceOracle)
		const finalVault = await getSecurityVault(client, securityPool, client.account.address)
		assert.strictEqual(finalActiveStagedOperationCount, 0n, 'manual overflow execution should consume the final active operation')
		assert.strictEqual(finalVault.coverageCommitmentAttoEth, fifthCoverageCommitmentAttoEth, 'coverage commitment')
	})

	test('many immediate operations reuse one cached price without opening additional reports', async () => {
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const initialCoverageCommitmentAttoEth = repDeposit / 4n
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, initialCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, costAttoEth)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)

		const settledPrice = await getLastPrice(client, priceOracle)
		const settlementTimestamp = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastSettlementTimestamp',
			address: priceOracle,
			args: [],
		})
		const immediateCoverageCommitmentsAttoEth = Array.from({ length: 12 }, (_, index) => repDeposit / BigInt(index + 5))

		for (const coverageCommitmentAttoEth of immediateCoverageCommitmentsAttoEth) {
			await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, coverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
			const vaultAfterOperation = await getSecurityVault(client, securityPool, client.account.address)
			assert.strictEqual(vaultAfterOperation.coverageCommitmentAttoEth, coverageCommitmentAttoEth, 'each immediate operation should execute in transaction order against the cached price')
			assert.strictEqual(await getPendingReportId(client, priceOracle), 0n, 'a valid cached price should execute immediately without opening another report')
			assert.strictEqual(await getActiveStagedOperationCount(client, priceOracle), 0n, 'each immediate operation should be consumed in its transaction')
		}

		const finalCoverageCommitmentAttoEth = immediateCoverageCommitmentsAttoEth.at(-1)
		if (finalCoverageCommitmentAttoEth === undefined) throw new Error('coverage commitment')
		const finalVault = await getSecurityVault(client, securityPool, client.account.address)
		const finalSettlementTimestamp = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastSettlementTimestamp',
			address: priceOracle,
			args: [],
		})
		assert.strictEqual(finalVault.coverageCommitmentAttoEth, finalCoverageCommitmentAttoEth, 'immediate operations should execute in transaction order against the cached price')
		assert.strictEqual(await getLastPrice(client, priceOracle), settledPrice, 'immediate operations should not mutate the accepted cached price')
		assert.strictEqual(finalSettlementTimestamp, settlementTimestamp, 'immediate operations should not manufacture additional oracle settlements')
	})

	test('empty-vault withdrawals cannot occupy pending oracle settlement slots', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const costAttoEth = await getRequestPriceCostAttoEth(attackerClient, priceOracle)

		await assert.rejects(async () => await requestPriceIfNeededAndStageOperationWithValue(attackerClient, priceOracle, OperationType.WithdrawRep, attackerClient.account.address, repDeposit, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, costAttoEth), /withdraw amount has no effect/i)

		const pendingReportId = await getPendingReportId(client, priceOracle)
		const pendingSettlementOperationCount = await getPendingSettlementOperationCount(client, priceOracle)
		const activeStagedOperationCount = await getActiveStagedOperationCount(client, priceOracle)
		assert.strictEqual(pendingReportId, 0n, 'zero-effect withdrawal must not request an oracle report')
		assert.strictEqual(pendingSettlementOperationCount, 0n, 'zero-effect withdrawal must not occupy a pending settlement slot')
		assert.strictEqual(activeStagedOperationCount, 0n, 'zero-effect withdrawal must not remain staged')
	})

	test('over-requested withdrawals withdraw the actual available REP', async () => {
		const withdrawalClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const availableRep = repDeposit
		await approveAndDepositRepToVault(withdrawalClient, availableRep, questionId)
		const costAttoEth = await getRequestPriceCostAttoEth(withdrawalClient, priceOracle)

		const oversizedWithdrawal = availableRep * 10n
		await requestPriceIfNeededAndStageOperationWithValue(withdrawalClient, priceOracle, OperationType.WithdrawRep, withdrawalClient.account.address, oversizedWithdrawal, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, costAttoEth)
		await settlePendingReportWithPrice(10n ** 18n)

		const vaultAfterWithdrawal = await getSecurityVault(client, securityPool, withdrawalClient.account.address)
		assert.strictEqual(vaultAfterWithdrawal.repBackingUnits, 0n, 'over-requested withdrawal should still withdraw the full vault balance')
	})

	test('pending withdrawals that become zero-effect during execution fail without blocking the successful withdrawal', async () => {
		const withdrawalClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const availableRep = repDeposit / 2n
		await approveAndDepositRepToVault(withdrawalClient, availableRep, questionId)
		const costAttoEth = await getRequestPriceCostAttoEth(withdrawalClient, priceOracle)
		const queuedOperationCostAttoEth = await getQueuedOperationCostAttoEth(withdrawalClient, priceOracle)

		await requestPriceIfNeededAndStageOperationWithValue(withdrawalClient, priceOracle, OperationType.WithdrawRep, withdrawalClient.account.address, availableRep, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, costAttoEth)
		await requestPriceIfNeededAndStageOperationWithValue(withdrawalClient, priceOracle, OperationType.WithdrawRep, withdrawalClient.account.address, availableRep, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, queuedOperationCostAttoEth)

		const { settleReceipt } = await settlePendingReportWithPrice(10n ** 18n)

		const vaultAfterSettlement = await getSecurityVault(client, securityPool, withdrawalClient.account.address)
		const firstStagedOperation = await getStagedOperation(client, priceOracle, 1n)
		const secondStagedOperation = await getStagedOperation(client, priceOracle, 2n)
		const executionLogs = findExecutedStagedOperationLogs(settleReceipt.logs)
		const secondExecutionLog = executionLogs.find(log => log?.args.operationId === 2n)
		if (secondExecutionLog === undefined) throw new Error('missing zero-effect withdrawal execution log')

		assert.strictEqual(secondExecutionLog.args.success, false, 'second pending withdrawal should fail after the first empties the vault')
		assert.strictEqual(secondExecutionLog.args.errorMessage, 'withdraw amount has no effect', 'second pending withdrawal should expose the zero-effect reason')
		assert.strictEqual(vaultAfterSettlement.repBackingUnits, 0n, 'first pending withdrawal should empty the vault')
		assert.strictEqual(firstStagedOperation[1], zeroAddress, 'successful pending withdrawal should be consumed')
		assert.strictEqual(secondStagedOperation[1], zeroAddress, 'zero-effect pending withdrawal should be consumed')
	})

	test('liquidations too close to the threshold are rejected even when the oracle price is valid', async () => {
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const targetCoverageCommitmentAttoEth = 75n * 10n ** 18n
		const coverageCommitmentTransferAttoEth = 10n * 10n ** 18n
		const nearThresholdPrice = 7n * 10n ** 18n
		const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRepToVault(liquidatorClient, securityPool, repDeposit)

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetCoverageCommitment, client.account.address, targetCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, costAttoEth)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await mockWindow.advanceTime(DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS + 1n)

		await requestPriceIfNeededAndStageOperationWithInitialReportPrice(liquidatorClient, priceOracle, OperationType.Liquidation, client.account.address, coverageCommitmentTransferAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, nearThresholdPrice, costAttoEth)
		await handleOracleReporting(client, mockWindow, priceOracle, nearThresholdPrice)

		const targetVault = await getSecurityVault(client, securityPool, client.account.address)
		const liquidatorVault = await getSecurityVault(client, securityPool, liquidatorClient.account.address)
		const stagedOperation = await getStagedOperation(client, priceOracle, 2n)

		assert.strictEqual(targetVault.coverageCommitmentAttoEth, targetCoverageCommitmentAttoEth, 'coverage commitment')
		assert.strictEqual(liquidatorVault.coverageCommitmentAttoEth, 0n, 'near-threshold liquidations must not transfer coverage commitment to the liquidator vault')
		assert.strictEqual(stagedOperation[1], zeroAddress, 'near-threshold liquidation attempts should be consumed as failed staged operations')
	})

	test('staged operations can only be executed once', async () => {
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const queuedOperationCostAttoEth = await getQueuedOperationCostAttoEth(client, priceOracle)
		const successfulCoverageCommitmentAttoEth = repDeposit / 4n
		const manualOperationId = 5n

		await fillPendingSettlementOperationList(costAttoEth, queuedOperationCostAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS)
		await queueStagedOperation(OperationType.SetCoverageCommitment, client.account.address, successfulCoverageCommitmentAttoEth, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await executeStagedOperation(client, priceOracle, manualOperationId)

		await assert.rejects(async () => await executeStagedOperation(client, priceOracle, manualOperationId), /Staged operation unavailable/)
	})

	test('non-liquidation staged operations require the initiator vault as target', async () => {
		const otherVault = addressString(TEST_ADDRESSES[1])
		const nonLiquidationOperations = [OperationType.WithdrawRep, OperationType.SetCoverageCommitment]

		for (const operation of nonLiquidationOperations) {
			await assert.rejects(async () => await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, operation, otherVault, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n), /Self operation target mismatch/)
		}
	})

	test('staged liquidations expire after their caller-selected validity window', async () => {
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const queuedOperationCostAttoEth = await getQueuedOperationCostAttoEth(client, priceOracle)
		const liquidationTimeoutSeconds = 60n
		const manualOperationId = 5n
		const targetVault = addressString(TEST_ADDRESSES[1])

		await fillPendingSettlementOperationList(costAttoEth, queuedOperationCostAttoEth, liquidationTimeoutSeconds)
		await queueStagedOperation(OperationType.Liquidation, targetVault, 1n, liquidationTimeoutSeconds)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await mockWindow.advanceTime(liquidationTimeoutSeconds + 1n)

		const expiredExecutionHash = await executeStagedOperation(client, priceOracle, manualOperationId)
		const expiredOperation = await getStagedOperation(client, priceOracle, manualOperationId)
		const expiredExecutionReceipt = await client.waitForTransactionReceipt({ hash: expiredExecutionHash })
		const executionLog = findExecutedStagedOperationLog(expiredExecutionReceipt.logs)
		if (executionLog === undefined) throw new Error('missing expired liquidation execution event')
		assert.strictEqual(expiredOperation[1], zeroAddress, 'expired liquidation should be consumed after execution attempt')
		assert.strictEqual(executionLog.args.operationId, manualOperationId)
		assert.strictEqual(executionLog.args.operation, BigInt(OperationType.Liquidation))
		assert.strictEqual(executionLog.args.success, false)
		assert.strictEqual(executionLog.args.errorMessage, 'staged operation expired')
	})

	test('staged self operations expire after their caller-selected validity window', async () => {
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const queuedOperationCostAttoEth = await getQueuedOperationCostAttoEth(client, priceOracle)
		const selfOperationTimeoutSeconds = 60n
		const manualOperationId = 5n

		await fillPendingSettlementOperationList(costAttoEth, queuedOperationCostAttoEth, selfOperationTimeoutSeconds)
		await queueStagedOperation(OperationType.SetCoverageCommitment, client.account.address, 1n, selfOperationTimeoutSeconds)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await mockWindow.advanceTime(selfOperationTimeoutSeconds + 1n)

		const expiredExecutionHash = await executeStagedOperation(client, priceOracle, manualOperationId)
		const expiredOperation = await getStagedOperation(client, priceOracle, manualOperationId)
		const expiredExecutionReceipt = await client.waitForTransactionReceipt({ hash: expiredExecutionHash })
		const executionLog = findExecutedStagedOperationLog(expiredExecutionReceipt.logs)
		if (executionLog === undefined) throw new Error('missing expired self-operation execution event')
		assert.strictEqual(expiredOperation[1], zeroAddress, 'expired self operation should be consumed after execution attempt')
		assert.strictEqual(executionLog.args.operationId, manualOperationId)
		assert.strictEqual(executionLog.args.operation, BigInt(OperationType.SetCoverageCommitment))
		assert.strictEqual(executionLog.args.success, false)
		assert.strictEqual(executionLog.args.errorMessage, 'staged operation expired')
	})
})
