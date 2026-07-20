import { test, beforeEach, describe, setDefaultTimeout } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { decodeEventLog, encodeAbiParameters, encodeDeployData, keccak256, type Address, type Hex, zeroAddress } from '@zoltar/shared/ethereum'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, hashOpenOracleStatePreimage, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'
import { DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS, calculateOracleMinimumWethReport } from '@zoltar/shared/oracleInitialReport'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient } from '../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, DAY, WETH_ADDRESS } from '../testSupport/simulator/utils/constants'
import { addressString, dateToBigintSeconds } from '../testSupport/simulator/utils/bigint'
import { approveToken, setupTestAccounts, getERC20Balance, getETHBalance } from '../testSupport/simulator/utils/utilities'
import { approveAndDepositRep } from '../testSupport/simulator/utils/contracts/peripheralsTestUtils'
import { handleOracleReporting } from '../testSupport/simulator/utils/contracts/peripheralsTestUtils'
import { OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, applyLibraries, deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import { createQuestion, getQuestionId } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { ensureZoltarDeployed } from '../testSupport/simulator/utils/contracts/zoltar'
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
	getQueuedOperationEthCost,
	getRequestPriceEthCost,
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
import { depositRep, getSecurityVault } from '../testSupport/simulator/utils/contracts/securityPool'
import { peripherals_openOracle_OpenOracle_OpenOracle, peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '../types/contractArtifact'
import { isIgnorableLogDecodeError } from './logDecodeErrors'
import { replayZoltarEvents, type ReplayLog } from './eventReplay/eventReplayModel'

setDefaultTimeout(TEST_TIMEOUT_MS)

type TransactionReceiptLogs = Awaited<ReturnType<WriteClient['waitForTransactionReceipt']>>['logs']
const OPEN_ORACLE_GAME_MAPPING_SLOT = 1n

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

type OracleCoordinatorConstructorArgs = [Address, Address, Address, bigint, number, bigint, bigint, bigint, number, number, number, number, number, boolean, boolean, Address, bigint, bigint, bigint]

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
	const securityMultiplier = 2n
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
		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier)
		await approveAndDepositRep(client, repDeposit, questionId)
		const addresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)
		priceOracle = addresses.priceOracleManagerAndOperatorQueuer
		securityPool = addresses.securityPool
	})

	const queueStagedOperation = async (operation: OperationType, targetVault: Address, amount: bigint, validForSeconds: bigint, value = 0n) => await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, operation, targetVault, amount, validForSeconds, value)
	const fillPendingSettlementOperationList = async (ethCost: bigint, queuedOperationEthCost: bigint, validForSeconds: bigint) => {
		for (let index = 0; index < 4; index++) {
			await queueStagedOperation(OperationType.SetSecurityBondsAllowance, client.account.address, BigInt(index + 1), validForSeconds, index === 0 ? ethCost : queuedOperationEthCost)
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
		const [pendingReportId, pendingReportSponsor, pendingOperationSlotId, pendingReportMaxSettlementBaseFee, lastPrice, lastSettlementTimestamp, stagedOperationCounter, activeStagedOperationCount, pendingSettlementOperationCount] = await Promise.all([
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
		assert.strictEqual(replayed.pendingReportMaxSettlementBaseFee, pendingReportMaxSettlementBaseFee, `${context}: settlement base-fee replay mismatch`)
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

		const minimumToken1Report = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1Report',
			address: priceOracle,
			args: [],
		})

		assert.strictEqual(minimumToken1Report, 1n, 'zero-basefee test chains should use only the one-wei OpenOracle non-zero minimum')
		await requestPrice(client, priceOracle)

		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		assert.strictEqual(reportMeta.exactToken1Report, minimumToken1Report, 'the request should snapshot the dynamic WETH requirement')
		assert.strictEqual(reportMeta.token1, WETH_ADDRESS, 'WETH should be the exact token1 report side')
		assert.strictEqual(reportMeta.token2.toLowerCase(), addressString(GENESIS_REPUTATION_TOKEN).toLowerCase(), 'REP should be the price-expressing token2 side')

		const baseFeeWeiPerGas = 30n * 10n ** 9n
		await mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${baseFeeWeiPerGas.toString(16)}`] })
		await mockWindow.request({ method: 'evm_mine', params: [] })
		const sizedForBaseFee = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1Report',
			address: priceOracle,
			args: [],
		})
		assert.strictEqual(sizedForBaseFee, calculateOracleMinimumWethReport({ ...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS, baseFeeWeiPerGas }), 'the on-chain WETH calculation should match the shared integer formula')
	})

	test('caller can voluntarily fund initial WETH above the coordinator minimum', async () => {
		const proposedRepPerEthPrice = 10n ** 18n
		const requestedInitialWeth = 10n
		const requestPriceWithMinimumAbi = [
			{
				inputs: [
					{ name: 'proposedRepPerEthPrice', type: 'uint256' },
					{ name: 'requestedInitialWeth', type: 'uint256' },
				],
				name: 'requestPrice',
				outputs: [],
				stateMutability: 'payable',
				type: 'function',
			},
		] as const

		await wrapWeth(client, requestedInitialWeth)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)

		const hash = await client.writeContract({
			abi: requestPriceWithMinimumAbi,
			functionName: 'requestPrice',
			address: priceOracle,
			args: [proposedRepPerEthPrice, requestedInitialWeth],
			value: await getRequestPriceEthCost(client, priceOracle),
		})
		await client.waitForTransactionReceipt({ hash })

		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		const reportStatus = await getOpenOracleReportStatus(client, reportId)
		assert.strictEqual(reportMeta.exactToken1Report, requestedInitialWeth, 'OpenOracle should require the larger caller-selected initial WETH amount')
		assert.strictEqual(reportMeta.escalationHalt, requestedInitialWeth * 10n, 'the escalation halt should scale from the actual initial WETH amount')
		assert.strictEqual(reportStatus.currentAmount1, requestedInitialWeth, 'the initial report should contain the caller-selected WETH amount')
		assert.strictEqual(reportStatus.currentAmount2, requestedInitialWeth, 'the coordinator should derive matching REP from the selected WETH amount and proposed price')
	})

	test('coordinator settlement returns the undisputed report liquidity to the sponsor wallet', async () => {
		const proposedRepPerEthPrice = 10n ** 18n
		const requestedInitialWeth = 10n
		await wrapWeth(client, requestedInitialWeth)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)
		const wethBalanceBeforeRequest = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
		const repBalanceBeforeRequest = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		await requestPriceWithValue(client, priceOracle, await getRequestPriceEthCost(client, priceOracle), proposedRepPerEthPrice, requestedInitialWeth)
		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		const reportStatus = await getOpenOracleReportStatus(client, reportId)
		assert.strictEqual(reportStatus.currentReporter, priceOracle, 'the coordinator should own the initial reporter position until settlement')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), wethBalanceBeforeRequest - requestedInitialWeth, 'the pending report should hold the sponsored WETH')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), repBalanceBeforeRequest - requestedInitialWeth, 'the pending report should hold the sponsored REP')

		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await openOracleSettle(client, reportId)
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), wethBalanceBeforeRequest, 'settlement should return the coordinator reporter WETH to the sponsor')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), repBalanceBeforeRequest, 'settlement should return the coordinator reporter REP to the sponsor')
	})

	test('request-block WETH sizing preserves the submitted REP per ETH price after basefee moves', async () => {
		const requestBaseFeeWeiPerGas = 45n * 10n ** 9n
		const proposedRepPerEthPrice = 1000n * 10n ** 18n
		const maximumMinimumWethReport = calculateOracleMinimumWethReport({ ...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS, baseFeeWeiPerGas: requestBaseFeeWeiPerGas })
		await wrapWeth(client, maximumMinimumWethReport)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)

		await mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${requestBaseFeeWeiPerGas.toString(16)}`] })
		await mockWindow.request({ method: 'evm_mine', params: [] })
		const requestMinimumWethReport = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1Report',
			address: priceOracle,
			args: [],
		})
		const requestHash = await client.writeContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPrice',
			address: priceOracle,
			args: [proposedRepPerEthPrice, 0n],
			value: (await getRequestPriceEthCost(client, priceOracle)) + requestMinimumWethReport,
			gasPrice: requestBaseFeeWeiPerGas,
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
		tunedArgs[6] = tunedTargetPriceError
		tunedArgs[7] = tunedOpenOracleSecurityMultiplierBps
		const tunedCoordinator = await deployContract(encodeOracleCoordinatorDeployData(tunedArgs))

		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'targetPriceErrorForDispute', address: tunedCoordinator, args: [] }), tunedTargetPriceError)
		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'openOracleSecurityMultiplierBps', address: tunedCoordinator, args: [] }), tunedOpenOracleSecurityMultiplierBps)

		const baseFeeWeiPerGas = 30n * 10n ** 9n
		await mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${baseFeeWeiPerGas.toString(16)}`] })
		await mockWindow.request({ method: 'evm_mine', params: [] })
		assert.strictEqual(
			await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'minimumToken1Report', address: tunedCoordinator, args: [] }),
			calculateOracleMinimumWethReport({
				...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
				baseFeeWeiPerGas,
				openOracleSecurityMultiplierBps: tunedOpenOracleSecurityMultiplierBps,
				targetPriceErrorForDispute: tunedTargetPriceError,
			}),
		)
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
			targetPriceErrorForDispute,
			openOracleSecurityMultiplierBps,
			baseArgs[8],
			baseArgs[9],
			protocolFee,
			feePercentage,
			baseArgs[12],
			baseArgs[13],
			baseArgs[14],
			baseArgs[15],
			baseArgs[16],
			baseArgs[17],
			baseArgs[18],
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
			escalationHaltMultiplierBps,
			maxSettlementBaseFeeMultiplierBps,
			minLiquidationPriceDistanceBps,
		]
		const invalidRiskParameterCases: Array<{ args: OracleCoordinatorConstructorArgs; message: RegExp }> = [
			{
				args: buildArgsWithSizingParameters(0n, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_PROTOCOL_FEE, ORACLE_FEE_PERCENTAGE),
				message: /dispute gas units must be greater than zero/i,
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
				args: buildArgsWithRiskParameters(0n, ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS, ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS),
				message: /escalation halt multiplier must be greater than zero/i,
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

	test('oracle settlement accepts the exact nonzero basefee cap and rejects one wei above it', async () => {
		const requestBaseFeeWeiPerGas = 1n * 10n ** 9n
		const expectedSettlementBaseFeeCap = (requestBaseFeeWeiPerGas * ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS) / 10000n
		const minimumWethReport = calculateOracleMinimumWethReport({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			baseFeeWeiPerGas: requestBaseFeeWeiPerGas,
		})
		const callbackGasLimit = BigInt(ORACLE_SETTLEMENT_GAS) * 4n
		const requestEthCost = requestBaseFeeWeiPerGas * 4n * (callbackGasLimit + ORACLE_REPORT_GAS) + 101n
		const proposedRepPerEthPrice = 10n ** 18n

		await wrapWeth(client, minimumWethReport * 2n)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)

		const requestAtConfiguredBaseFee = async () => {
			await mockWindow.request({
				method: 'anvil_setNextBlockBaseFeePerGas',
				params: [`0x${requestBaseFeeWeiPerGas.toString(16)}`],
			})
			const requestHash = await client.writeContract({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'requestPrice',
				address: priceOracle,
				args: [proposedRepPerEthPrice, 0n],
				value: requestEthCost,
				gasPrice: requestBaseFeeWeiPerGas,
			})
			await client.waitForTransactionReceipt({ hash: requestHash })
			const reportId = await getPendingReportId(client, priceOracle)
			assert.ok(reportId > 0n, 'nonzero-basefee request should create a pending report')
			assert.strictEqual(await getPendingReportMaxSettlementBaseFee(client, priceOracle), expectedSettlementBaseFeeCap, 'request should snapshot the configured nonzero settlement basefee cap')
			return reportId
		}

		const acceptedReportId = await requestAtConfiguredBaseFee()
		const acceptedReportMeta = await getOpenOracleReportMeta(client, acceptedReportId)
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
		assert.strictEqual(findPriceReportedLog(rejectedReceipt.logs), undefined, 'settlement one wei above the basefee cap must not report a price')
		assert.strictEqual(rejectedLog.args.reason, 'Base fee too high', 'settlement one wei above the cap should expose the basefee rejection reason')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'settlement one wei above the basefee cap must leave the stale price invalid')
	})

	test('oracle settlement skips price updates and staged execution when settlement basefee is too high', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const unsafeAllowance = repDeposit / 4n

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, unsafeAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)

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
		assert.strictEqual(vault.securityBondAllowance, 0n, 'high-basefee settlement must not execute staged allowance updates')
		assert.strictEqual(rejectedLog.args.reportId, pendingReportId, 'PriceReportRejected should identify the rejected report')
		assert.strictEqual(rejectedLog.args.reason, 'Base fee too high', 'PriceReportRejected should expose the rejection reason')
		assert.strictEqual(rejectedLog.args.pendingReportId, pendingReportIdAfterSettlement, 'PriceReportRejected should expose the cleared pending report id')
		assert.strictEqual(rejectedLog.args.pendingReportMaxSettlementBaseFee, pendingMaxSettlementBaseFeeAfterSettlement, 'PriceReportRejected should expose the cleared basefee guard')
		assert.strictEqual(rejectedLog.args.lastPrice, lastPriceBeforeSettlement, 'PriceReportRejected should expose the unchanged last price')
		assert.strictEqual(rejectedLog.args.lastSettlementTimestamp, lastSettlementTimestampBeforeSettlement, 'PriceReportRejected should expose the unchanged settlement timestamp')

		await requestPrice(client, priceOracle)
		const recoveryPendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(recoveryPendingReportId > 0n, 'oracle state should recover after a high-basefee settlement clears the report')
	})

	test('requestPrice should refund excess Ether when overpaid', async () => {
		// Test that overpayment is refunded, not kept by contract
		const initialBalance = await getETHBalance(client, client.account.address)
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const overpayment = ethCost * 2n
		const minimumWethReport = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1Report',
			address: priceOracle,
			args: [],
		})

		// Call requestPrice with overpayment
		await requestPriceWithValue(client, priceOracle, overpayment)

		const finalBalance = await getETHBalance(client, client.account.address)

		// The helper wraps a 2x WETH execution buffer before requesting the report.
		// The unused WETH remains with the caller; any extra native ETH value should
		// still be refunded by the coordinator.
		const expectedEthDecrease = ethCost + minimumWethReport * 2n
		assert.strictEqual(initialBalance - finalBalance, expectedEthDecrease, `Caller should spend the ETH bounty plus the buffered WETH funding (${expectedEthDecrease}), but spent ${initialBalance - finalBalance}`)
	})

	test('requestPriceIfNeededAndStageOperation should not drain preexisting contract balance', async () => {
		// This test verifies that pre-existing ETH in the contract is not refunded to the caller
		// (drain vulnerability). It works even when price is invalid (so requestPrice is called internally).

		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const preBalance = ethCost * 3n // some arbitrary pre-existing balance

		// Use the abstracted method to set the contract's ETH balance
		await mockWindow.setBalance(priceOracle, preBalance)

		// Verify initial contract balance
		const balanceBefore = await getETHBalance(client, priceOracle)
		assert.strictEqual(balanceBefore, preBalance, 'Pre-set balance should be set correctly')

		// Call requestPriceIfNeededAndStageOperation with overpayment
		const caller = client.account.address
		const sendValue = ethCost * 2n
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.WithdrawRep, caller, 100n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, sendValue)

		// After the call, the pre-existing balance should remain intact.
		// The contract should have retained ethCost (to pay OpenOracle) and refunded the excess (sendValue - ethCost).
		// Final balance = preBalance (unchanged)
		const balanceAfter = await getETHBalance(client, priceOracle)
		assert.strictEqual(balanceAfter, preBalance, `Contract should retain preexisting balance (${preBalance}) after requestPriceIfNeededAndStageOperation, but it was drained to ${balanceAfter}`)
	})

	test('failed staged operations are consumed after oracle settlement', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const impossibleAllowance = repDeposit * 10n

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, impossibleAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)

		const pendingOperationSlotId = await getPendingOperationSlotId(client, priceOracle)
		const stagedOperation = await getStagedOperation(client, priceOracle, 1n)

		assert.strictEqual(pendingOperationSlotId, 0n, 'failed auto-executed operations should clear the pending slot')
		assert.strictEqual(stagedOperation[1], zeroAddress, 'failed staged operations should be consumed after their first execution attempt')
		assert.strictEqual(stagedOperation[3], impossibleAllowance, 'failed staged operations should retain their record for auditability')

		await assert.rejects(async () => await executeStagedOperation(client, priceOracle, 1n), /staged operation does not exist/i)
	})

	test('only the pending report sponsor can queue more operations while settlement is pending', async () => {
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const sponsorAllowance = repDeposit / 4n
		const counterpartyAllowance = repDeposit / 5n

		await approveToken(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRep(counterpartyClient, securityPool, repDeposit)

		const sponsorRequestHash = await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, sponsorAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		const sponsorRequestReceipt = await client.waitForTransactionReceipt({ hash: sponsorRequestHash })
		await assertCoordinatorReplayMatchesStorage(sponsorRequestReceipt.logs, 'sponsored report request')

		const pendingReportIdBeforeJoin = await getPendingReportId(client, priceOracle)
		const queuedOperationEthCost = await getQueuedOperationEthCost(client, priceOracle)
		const zeroCostJoinRejected = await counterpartyClient
			.simulateContract({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'requestPriceIfNeededAndStageOperation',
				address: priceOracle,
				args: [OperationType.SetSecurityBondsAllowance, counterpartyClient.account.address, counterpartyAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 1n, 0n],
				account: counterpartyClient.account,
			})
			.then(
				() => false,
				error => {
					if (!(error instanceof Error)) throw error
					return error.message.includes('Only the pending report sponsor can queue more operations until settlement')
				},
			)

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, counterpartyAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, queuedOperationEthCost)

		const pendingReportIdAfterJoin = await getPendingReportId(client, priceOracle)

		assert.strictEqual(queuedOperationEthCost, 0n, 'queued operation joins should no longer charge an ETH fee')
		assert.strictEqual(pendingReportIdAfterJoin, pendingReportIdBeforeJoin, 'the sponsor should reuse the existing oracle request')
		assert.strictEqual(zeroCostJoinRejected, true, 'non-sponsors should be rejected while a pending oracle settlement is in flight')
		assert.strictEqual((await getPendingSettlementOperationIds(client, priceOracle)).length, 2, 'the sponsor should still be able to queue additional pending operations without paying a join fee')
	})

	test('rolling OpenOracle disputes extend sponsor exclusivity without corrupting the pending operation queue', async () => {
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const sponsorAllowance = repDeposit / 4n
		const sponsorAllowanceAfterDispute = repDeposit / 5n
		await approveToken(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRep(counterpartyClient, securityPool, repDeposit)
		await requestPriceIfNeededAndStageOperationWithInitialReportPrice(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, sponsorAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 10n ** 18n, ethCost, 1000n)

		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		const reportStatusBeforeDispute = await getOpenOracleReportStatus(client, reportId)
		const extraDataBeforeDispute = await getOpenOracleExtraData(client, reportId)
		const preimageBeforeDispute = (await loadOpenOracleEventState(client, reportId)).latest
		const openOracle = getInfraContractAddresses().openOracle
		const sponsorRepBalanceAfterRequest = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		const sponsorWethBalanceAfterRequest = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
		const disputedAmount1 = (reportStatusBeforeDispute.currentAmount1 * reportMeta.multiplier) / 100n
		const disputedAmount2 = (reportStatusBeforeDispute.currentAmount2 * 8n) / 10n
		const disputeFee = (reportStatusBeforeDispute.currentAmount2 * reportMeta.feePercentage) / 10_000_000n
		const disputeProtocolFee = (reportStatusBeforeDispute.currentAmount2 * reportMeta.protocolFee) / 10_000_000n
		const sponsorRepPayout = 2n * reportStatusBeforeDispute.currentAmount2 + disputeFee
		await wrapWeth(counterpartyClient, reportStatusBeforeDispute.currentAmount1 * 3n)
		await approveToken(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
		await approveToken(counterpartyClient, WETH_ADDRESS, openOracle)
		const counterpartyRepBalanceBeforeDispute = await getERC20Balance(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), counterpartyClient.account.address)
		const counterpartyWethBalanceBeforeDispute = await getERC20Balance(counterpartyClient, WETH_ADDRESS, counterpartyClient.account.address)
		const disputeHash = await counterpartyClient.writeContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'dispute',
			address: openOracle,
			args: [reportId, addressString(GENESIS_REPUTATION_TOKEN), disputedAmount1, disputedAmount2, counterpartyClient.account.address, false, false, getOpenOracleGameTuple(preimageBeforeDispute.game), getOpenOracleHelperTuple(preimageBeforeDispute.helper), [0n, 0n, 0n, 0n]],
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
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), sponsorWethBalanceAfterRequest, 'the sponsor should not receive WETH when the disputer swaps REP')
		assert.strictEqual(
			await getERC20Balance(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), counterpartyClient.account.address),
			counterpartyRepBalanceBeforeDispute - disputedAmount2 - reportStatusBeforeDispute.currentAmount2 - disputeFee - disputeProtocolFee,
			'the disputer should fund the replacement REP, swap principal, reporter fee, and protocol fee exactly',
		)
		assert.strictEqual(await getERC20Balance(counterpartyClient, WETH_ADDRESS, counterpartyClient.account.address), counterpartyWethBalanceBeforeDispute - (disputedAmount1 - reportStatusBeforeDispute.currentAmount1), 'the disputer should fund only the incremental WETH collateral before settlement')
		assert.strictEqual(await getOpenOracleHeldBalance(client, counterpartyClient.account.address, addressString(GENESIS_REPUTATION_TOKEN)), 1n, 'the disputer REP slot should contain only its sentinel before settlement')
		assert.strictEqual(await getOpenOracleHeldBalance(client, counterpartyClient.account.address, WETH_ADDRESS), 1n, 'the disputer WETH slot should contain only its sentinel before settlement')

		await assert.rejects(
			counterpartyClient.simulateContract({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'requestPriceIfNeededAndStageOperation',
				address: priceOracle,
				args: [OperationType.SetSecurityBondsAllowance, counterpartyClient.account.address, repDeposit / 6n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 1n, 0n],
				account: counterpartyClient.account,
			}),
			/Only the pending report sponsor can queue more operations until settlement/,
		)
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, sponsorAllowanceAfterDispute, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		assert.deepStrictEqual(await getPendingSettlementOperationIds(client, priceOracle), [1n, 2n], 'the original sponsor should retain queue append rights after a dispute')

		await mockWindow.setTime(reportStatusAfterDispute.reportTimestamp + reportMeta.settlementTime - 1n)
		await openOracleSettle(client, reportId)
		assert.strictEqual(await getPendingReportId(client, priceOracle), 0n, 'settlement should clear the disputed pending report')
		assert.deepStrictEqual(await getPendingSettlementOperationIds(client, priceOracle), [], 'settlement should consume the undamaged pending queue')
		assert.strictEqual((await getSecurityVault(client, securityPool, client.account.address)).securityBondAllowance, sponsorAllowanceAfterDispute, 'queued sponsor operations should execute in order after the final settlement')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), sponsorRepBalanceAfterRequest + sponsorRepPayout, 'settlement callback should pay the dispute proceeds to the original sponsor')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), sponsorWethBalanceAfterRequest, 'settlement callback should not invent a sponsor WETH payout')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, addressString(GENESIS_REPUTATION_TOKEN)), 1n, 'settlement callback should drain the coordinator REP credit to its sentinel')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, WETH_ADDRESS), 1n, 'settlement callback should leave the coordinator WETH sentinel intact')
		assert.strictEqual(await getOpenOracleHeldBalance(client, counterpartyClient.account.address, addressString(GENESIS_REPUTATION_TOKEN)), disputedAmount2 + 1n, 'settlement should credit the final REP collateral to the disputer')
		assert.strictEqual(await getOpenOracleHeldBalance(client, counterpartyClient.account.address, WETH_ADDRESS), disputedAmount1 + 1n, 'settlement should credit the final WETH collateral to the disputer')
	})

	test('only the pending report sponsor can queue overflow operations while settlement is pending', async () => {
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const queuedOperationEthCost = await getQueuedOperationEthCost(client, priceOracle)

		await approveToken(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRep(counterpartyClient, securityPool, repDeposit)
		await fillPendingSettlementOperationList(ethCost, queuedOperationEthCost, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS)

		const overflowRejected = await counterpartyClient
			.simulateContract({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'requestPriceIfNeededAndStageOperation',
				address: priceOracle,
				args: [OperationType.SetSecurityBondsAllowance, counterpartyClient.account.address, repDeposit / 5n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 1n, 0n],
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

		await assert.rejects(async () => await requestPrice(client, priceOracle), /A fresh oracle price is already available/i)
	})

	test('expired pending auto-execute slots do not block later valid oracle settlements', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const unsafeAllowance = repDeposit * 10n

		await requestPriceIfNeededAndStageOperationWithInitialReportPrice(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, unsafeAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 10n ** 18n, ethCost)

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
		assert.strictEqual(vault.securityBondAllowance, 0n, 'expired pending operations must not execute during later valid settlement')
	})

	test('failed OpenOracle settlement callbacks do not leave the coordinator permanently pending', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		await requestPriceWithValue(client, priceOracle, ethCost)

		const pendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(pendingReportId > 0n, 'setup should leave a pending oracle report')
		const pendingState = (await loadOpenOracleEventState(client, pendingReportId)).latest
		const sponsorRepBalanceAfterRequest = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		const sponsorWethBalanceAfterRequest = await getERC20Balance(client, WETH_ADDRESS, client.account.address)

		await settlePendingReportWithFailedCallback(pendingReportId)

		const pendingReportIdAfterSettlement = await getPendingReportId(client, priceOracle)
		assert.strictEqual(pendingReportIdAfterSettlement, pendingReportId, 'failed callbacks should leave recovery work to the coordinator recovery function')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), sponsorRepBalanceAfterRequest, 'failed callback settlement should not return REP before recovery')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), sponsorWethBalanceAfterRequest, 'failed callback settlement should not return WETH before recovery')
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
		assert.strictEqual(recoveryLog.args.pendingReportMaxSettlementBaseFee, pendingMaxSettlementBaseFeeAfterRecovery, 'PendingReportRecovered should expose the cleared basefee guard')
		assert.strictEqual(recoveryLog.args.lastPrice, lastPriceAfterRecovery, 'PendingReportRecovered should expose the unchanged last price')
		assert.strictEqual(recoveryLog.args.lastSettlementTimestamp, lastSettlementTimestampAfterRecovery, 'PendingReportRecovered should expose the unchanged settlement timestamp')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), sponsorRepBalanceAfterRequest + pendingState.game.currentAmount2, 'recovery should return the settled REP amount to the sponsor')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), sponsorWethBalanceAfterRequest + pendingState.game.currentAmount1, 'recovery should return the settled WETH amount to the sponsor')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, addressString(GENESIS_REPUTATION_TOKEN)), 1n, 'recovery should drain the coordinator REP credit to its sentinel')
		assert.strictEqual(await getOpenOracleHeldBalance(client, priceOracle, WETH_ADDRESS), 1n, 'recovery should drain the coordinator WETH credit to its sentinel')

		await requestPriceWithValue(client, priceOracle, ethCost)
		const nextPendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(nextPendingReportId > pendingReportId, 'recovery should allow creating a fresh oracle report')
	})

	test('pending report recovery rejects unsettled reports', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		await requestPriceWithValue(client, priceOracle, ethCost)

		await assert.rejects(recoverSettledPendingReport(client, priceOracle), /ReportNotSettled|reverted/i)
	})

	test('failed callback recovery clears the auto-execute slot so staged operations can request a fresh report', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const firstAllowance = repDeposit / 4n
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, firstAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)

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
		assert.strictEqual(vault.securityBondAllowance, 0n, 'recovery must not execute staged allowance changes without a successful callback')
		const recoveryLog = findPendingReportRecoveredLog(recoveryReceipt.logs)
		if (recoveryLog === undefined) throw new Error('missing PendingReportRecovered log')
		assert.strictEqual(recoveryLog.args.reportId, pendingReportId, 'PendingReportRecovered should identify the recovered report')
		assert.strictEqual(recoveryLog.args.pendingReportId, pendingReportIdAfterRecovery, 'PendingReportRecovered should expose the cleared pending report id')
		assert.strictEqual(recoveryLog.args.pendingReportMaxSettlementBaseFee, 0n, 'PendingReportRecovered should expose the cleared basefee guard')
		const recoveryConsumedLog = findPendingOperationRecoveryConsumedLog(recoveryReceipt.logs)
		assert.strictEqual(recoveryConsumedLog?.args.operationId, 1n, 'recovery should emit the consumed operation id')
		assert.strictEqual(recoveryConsumedLog?.args.operation, BigInt(OperationType.SetSecurityBondsAllowance), 'recovery should emit the consumed operation type')

		const secondAllowance = repDeposit / 5n
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, secondAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		const nextPendingReportId = await getPendingReportId(client, priceOracle)
		const nextPendingOperationSlotId = await getPendingOperationSlotId(client, priceOracle)

		assert.ok(nextPendingReportId > pendingReportId, 'a new staged operation should be able to fund a fresh report after recovery')
		assert.strictEqual(nextPendingOperationSlotId, 2n, 'the new staged operation should become the next auto-execute slot')
	})

	test('settlement auto-executes a bounded pending operation list and leaves overflow manual', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const queuedOperationEthCost = await getQueuedOperationEthCost(client, priceOracle)
		const firstAllowance = repDeposit / 4n
		const secondAllowance = repDeposit / 5n
		const thirdAllowance = repDeposit / 6n
		const fourthAllowance = repDeposit / 7n
		const fifthAllowance = repDeposit / 8n
		const queuedOperationLogs: TransactionReceiptLogs[number][] = []
		const queueOperation = async (allowance: bigint, value: bigint) => {
			const transactionHash = await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, allowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, value)
			const receipt = await client.getTransactionReceipt({ hash: transactionHash })
			queuedOperationLogs.push(...receipt.logs)
		}

		await queueOperation(firstAllowance, ethCost)
		await queueOperation(secondAllowance, queuedOperationEthCost)
		await queueOperation(thirdAllowance, queuedOperationEthCost)
		await queueOperation(fourthAllowance, queuedOperationEthCost)
		await queueOperation(fifthAllowance, 0n)

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
		assert.strictEqual(activeOperations[0]?.amount, fifthAllowance, 'newest overflow operation should retain its amount')
		assert.strictEqual(activeOperations[1]?.amount, fourthAllowance, 'newest pending operation should retain its amount')
		assert.strictEqual(activeOperations[2]?.amount, thirdAllowance, 'middle pending operation should retain its amount')
		assert.strictEqual(activeOperations[3]?.amount, secondAllowance, 'older pending operation should retain its amount')
		assert.strictEqual(activeOperations[4]?.amount, firstAllowance, 'oldest pending operation should retain its amount')

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
		assert.strictEqual(stagedOperation5[3], fifthAllowance, 'overflow operation should retain its requested amount until manual execution')
		assert.strictEqual(vaultAfterSettlement.securityBondAllowance, fourthAllowance, 'pending settlement operations should execute in queue order')
		assert.strictEqual(updatedActiveStagedOperationCount, 1n, 'active staged operation count should leave only the overflow operation')
		assert.deepStrictEqual(Array.from(remainingOperationIds), [5n], 'active staged operations should keep the overflow operation active')
		assert.strictEqual(remainingOperations[0]?.amount, fifthAllowance, 'overflow operation should stay in the active preview')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), true, 'settlement should leave a fresh price available for manual overflow execution')

		await executeStagedOperation(client, priceOracle, 5n)
		const finalActiveStagedOperationCount = await getActiveStagedOperationCount(client, priceOracle)
		const finalVault = await getSecurityVault(client, securityPool, client.account.address)
		assert.strictEqual(finalActiveStagedOperationCount, 0n, 'manual overflow execution should consume the final active operation')
		assert.strictEqual(finalVault.securityBondAllowance, fifthAllowance, 'manual overflow execution should apply the final allowance update')
	})

	test('many immediate operations reuse one cached price without opening additional reports', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const initialAllowance = repDeposit / 4n
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, initialAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)

		const settledPrice = await getLastPrice(client, priceOracle)
		const settlementTimestamp = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastSettlementTimestamp',
			address: priceOracle,
			args: [],
		})
		const immediateAllowances = Array.from({ length: 12 }, (_, index) => repDeposit / BigInt(index + 5))

		for (const allowance of immediateAllowances) {
			await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, allowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
			const vaultAfterOperation = await getSecurityVault(client, securityPool, client.account.address)
			assert.strictEqual(vaultAfterOperation.securityBondAllowance, allowance, 'each immediate operation should execute in transaction order against the cached price')
			assert.strictEqual(await getPendingReportId(client, priceOracle), 0n, 'a valid cached price should execute immediately without opening another report')
			assert.strictEqual(await getActiveStagedOperationCount(client, priceOracle), 0n, 'each immediate operation should be consumed in its transaction')
		}

		const finalAllowance = immediateAllowances.at(-1)
		if (finalAllowance === undefined) throw new Error('immediate allowance sequence must not be empty')
		const finalVault = await getSecurityVault(client, securityPool, client.account.address)
		const finalSettlementTimestamp = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastSettlementTimestamp',
			address: priceOracle,
			args: [],
		})
		assert.strictEqual(finalVault.securityBondAllowance, finalAllowance, 'immediate operations should execute in transaction order against the cached price')
		assert.strictEqual(await getLastPrice(client, priceOracle), settledPrice, 'immediate operations should not mutate the accepted cached price')
		assert.strictEqual(finalSettlementTimestamp, settlementTimestamp, 'immediate operations should not manufacture additional oracle settlements')
	})

	test('empty-vault withdrawals cannot occupy pending oracle settlement slots', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const ethCost = await getRequestPriceEthCost(attackerClient, priceOracle)

		await assert.rejects(async () => await requestPriceIfNeededAndStageOperationWithValue(attackerClient, priceOracle, OperationType.WithdrawRep, attackerClient.account.address, repDeposit, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost), /withdraw amount has no effect/i)

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
		await approveAndDepositRep(withdrawalClient, availableRep, questionId)
		const ethCost = await getRequestPriceEthCost(withdrawalClient, priceOracle)

		const oversizedWithdrawal = availableRep * 10n
		await requestPriceIfNeededAndStageOperationWithValue(withdrawalClient, priceOracle, OperationType.WithdrawRep, withdrawalClient.account.address, oversizedWithdrawal, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await settlePendingReportWithPrice(10n ** 18n)

		const vaultAfterWithdrawal = await getSecurityVault(client, securityPool, withdrawalClient.account.address)
		assert.strictEqual(vaultAfterWithdrawal.repDepositShare, 0n, 'over-requested withdrawal should still withdraw the full vault balance')
	})

	test('pending withdrawals that become zero-effect during execution fail without blocking the successful withdrawal', async () => {
		const withdrawalClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const availableRep = repDeposit / 2n
		await approveAndDepositRep(withdrawalClient, availableRep, questionId)
		const ethCost = await getRequestPriceEthCost(withdrawalClient, priceOracle)
		const queuedOperationEthCost = await getQueuedOperationEthCost(withdrawalClient, priceOracle)

		await requestPriceIfNeededAndStageOperationWithValue(withdrawalClient, priceOracle, OperationType.WithdrawRep, withdrawalClient.account.address, availableRep, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await requestPriceIfNeededAndStageOperationWithValue(withdrawalClient, priceOracle, OperationType.WithdrawRep, withdrawalClient.account.address, availableRep, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, queuedOperationEthCost)

		const { settleReceipt } = await settlePendingReportWithPrice(10n ** 18n)

		const vaultAfterSettlement = await getSecurityVault(client, securityPool, withdrawalClient.account.address)
		const firstStagedOperation = await getStagedOperation(client, priceOracle, 1n)
		const secondStagedOperation = await getStagedOperation(client, priceOracle, 2n)
		const executionLogs = findExecutedStagedOperationLogs(settleReceipt.logs)
		const secondExecutionLog = executionLogs.find(log => log?.args.operationId === 2n)
		if (secondExecutionLog === undefined) throw new Error('missing zero-effect withdrawal execution log')

		assert.strictEqual(secondExecutionLog.args.success, false, 'second pending withdrawal should fail after the first empties the vault')
		assert.strictEqual(secondExecutionLog.args.errorMessage, 'withdraw amount has no effect', 'second pending withdrawal should expose the zero-effect reason')
		assert.strictEqual(vaultAfterSettlement.repDepositShare, 0n, 'first pending withdrawal should empty the vault')
		assert.strictEqual(firstStagedOperation[1], zeroAddress, 'successful pending withdrawal should be consumed')
		assert.strictEqual(secondStagedOperation[1], zeroAddress, 'zero-effect pending withdrawal should be consumed')
	})

	test('liquidations too close to the threshold are rejected even when the oracle price is valid', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const targetAllowance = 75n * 10n ** 18n
		const liquidationAmount = 10n * 10n ** 18n
		const nearThresholdPrice = 7n * 10n ** 18n
		const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRep(liquidatorClient, securityPool, repDeposit)

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, targetAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await mockWindow.advanceTime(DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS + 1n)

		await requestPriceIfNeededAndStageOperationWithInitialReportPrice(liquidatorClient, priceOracle, OperationType.Liquidation, client.account.address, liquidationAmount, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, nearThresholdPrice, ethCost)
		await handleOracleReporting(client, mockWindow, priceOracle, nearThresholdPrice)

		const targetVault = await getSecurityVault(client, securityPool, client.account.address)
		const liquidatorVault = await getSecurityVault(client, securityPool, liquidatorClient.account.address)
		const stagedOperation = await getStagedOperation(client, priceOracle, 2n)

		assert.strictEqual(targetVault.securityBondAllowance, targetAllowance, 'near-threshold liquidations must not reduce the target vault allowance')
		assert.strictEqual(liquidatorVault.securityBondAllowance, 0n, 'near-threshold liquidations must not move debt to the liquidator vault')
		assert.strictEqual(stagedOperation[1], zeroAddress, 'near-threshold liquidation attempts should be consumed as failed staged operations')
	})

	test('staged operations can only be executed once', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const queuedOperationEthCost = await getQueuedOperationEthCost(client, priceOracle)
		const successfulAllowance = repDeposit / 4n
		const manualOperationId = 5n

		await fillPendingSettlementOperationList(ethCost, queuedOperationEthCost, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS)
		await queueStagedOperation(OperationType.SetSecurityBondsAllowance, client.account.address, successfulAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await executeStagedOperation(client, priceOracle, manualOperationId)

		await assert.rejects(async () => await executeStagedOperation(client, priceOracle, manualOperationId), /staged operation does not exist/i)
	})

	test('non-liquidation staged operations require the initiator vault as target', async () => {
		const otherVault = addressString(TEST_ADDRESSES[1])
		const nonLiquidationOperations = [OperationType.WithdrawRep, OperationType.SetSecurityBondsAllowance]

		for (const operation of nonLiquidationOperations) {
			await assert.rejects(async () => await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, operation, otherVault, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n), /self-targeted staged operation target must match the initiator/i)
		}
	})

	test('staged liquidations expire after their caller-selected validity window', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const queuedOperationEthCost = await getQueuedOperationEthCost(client, priceOracle)
		const liquidationTimeoutSeconds = 60n
		const manualOperationId = 5n
		const targetVault = addressString(TEST_ADDRESSES[1])

		await fillPendingSettlementOperationList(ethCost, queuedOperationEthCost, liquidationTimeoutSeconds)
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
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const queuedOperationEthCost = await getQueuedOperationEthCost(client, priceOracle)
		const selfOperationTimeoutSeconds = 60n
		const manualOperationId = 5n

		await fillPendingSettlementOperationList(ethCost, queuedOperationEthCost, selfOperationTimeoutSeconds)
		await queueStagedOperation(OperationType.SetSecurityBondsAllowance, client.account.address, 1n, selfOperationTimeoutSeconds)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await mockWindow.advanceTime(selfOperationTimeoutSeconds + 1n)

		const expiredExecutionHash = await executeStagedOperation(client, priceOracle, manualOperationId)
		const expiredOperation = await getStagedOperation(client, priceOracle, manualOperationId)
		const expiredExecutionReceipt = await client.waitForTransactionReceipt({ hash: expiredExecutionHash })
		const executionLog = findExecutedStagedOperationLog(expiredExecutionReceipt.logs)
		if (executionLog === undefined) throw new Error('missing expired self-operation execution event')
		assert.strictEqual(expiredOperation[1], zeroAddress, 'expired self operation should be consumed after execution attempt')
		assert.strictEqual(executionLog.args.operationId, manualOperationId)
		assert.strictEqual(executionLog.args.operation, BigInt(OperationType.SetSecurityBondsAllowance))
		assert.strictEqual(executionLog.args.success, false)
		assert.strictEqual(executionLog.args.errorMessage, 'staged operation expired')
	})
})
