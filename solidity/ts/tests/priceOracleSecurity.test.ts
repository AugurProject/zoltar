import { test, beforeEach, describe, setDefaultTimeout } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { decodeEventLog, encodeAbiParameters, encodeDeployData, keccak256, type Address, type Hex, zeroAddress } from '@zoltar/shared/ethereum'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient } from '../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, DAY, WETH_ADDRESS } from '../testSupport/simulator/utils/constants'
import { addressString, dateToBigintSeconds } from '../testSupport/simulator/utils/bigint'
import { approveToken, setupTestAccounts, getERC20Balance, getETHBalance } from '../testSupport/simulator/utils/utilities'
import { approveAndDepositRep } from '../testSupport/simulator/utils/contracts/peripheralsTestUtils'
import { handleOracleReporting } from '../testSupport/simulator/utils/contracts/peripheralsTestUtils'
import { ORACLE_EXACT_TOKEN1_REPORT, deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from '../testSupport/simulator/utils/contracts/deployPeripherals'
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
	getPendingOperationSlotId,
	getPendingReportId,
	getPendingReportMaxSettlementBaseFee,
	getPendingSettlementOperationCount,
	getPendingSettlementOperationIds,
	getPriceRoundConsumedNotional,
	getPriceRoundMaxNotional,
	getPriceRoundRemainingNotional,
	getQueuedOperationEthCost,
	getRequestPriceEthCost,
	getStagedOperation,
	openOracleSettle,
	openOracleSettleWithGasPrice,
	recoverSettledPendingReport,
	requestPrice,
	requestPriceIfNeededAndStageOperationWithInitialReportAmount2,
	requestPriceIfNeededAndStageOperationWithValue,
	requestPriceWithValue,
} from '../testSupport/simulator/utils/contracts/peripherals'
import { depositRep, getSecurityVault, poolOwnershipToRep } from '../testSupport/simulator/utils/contracts/securityPool'
import { peripherals_openOracle_OpenOracle_OpenOracle, peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '../types/contractArtifact'
import { isIgnorableLogDecodeError } from './logDecodeErrors'

setDefaultTimeout(TEST_TIMEOUT_MS)

type TransactionReceiptLogs = Awaited<ReturnType<WriteClient['waitForTransactionReceipt']>>['logs']
const OPEN_ORACLE_EXTRA_DATA_MAPPING_SLOT = 6n

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

const findSettlementCallbackExecutedLog = (logs: TransactionReceiptLogs) =>
	logs
		.map(log => {
			try {
				return decodeEventLog({
					abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
					data: log.data,
					topics: log.topics,
				})
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				return undefined
			}
		})
		.find(log => log?.eventName === 'SettlementCallbackExecuted')

type OracleCoordinatorConstructorArgs = [Address, Address, Address, bigint, number, bigint, number, number, number, number, number, boolean, boolean, Address, bigint, bigint, bigint]

function encodeOracleCoordinatorDeployData(args: OracleCoordinatorConstructorArgs) {
	return encodeDeployData({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		bytecode: `0x${peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.evm.bytecode.object}`,
		args,
	})
}

function formatStorageSlot(slot: bigint) {
	return `0x${slot.toString(16).padStart(64, '0')}`
}

function getMappingStorageSlot(key: bigint, mappingSlot: bigint) {
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [key, mappingSlot])))
}

function packOpenOracleExtraCallbackSlot(callbackContract: Address, numReports: number, callbackGasLimit: number) {
	return BigInt(callbackContract) | (BigInt(numReports) << 160n) | (BigInt(callbackGasLimit) << 192n)
}

describe('Price Oracle Refund Security Tests', () => {
	const DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS = 5n * 60n
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const repDeposit = 1000n * 10n ** 18n
	const currentTimestamp = dateToBigintSeconds(new Date())
	const questionEndDate = currentTimestamp + 365n * DAY
	let priceOracle: Address
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
		ORACLE_EXACT_TOKEN1_REPORT,
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
		const extraData = await getOpenOracleExtraData(client, pendingReportId)

		const callbackSlot = getMappingStorageSlot(pendingReportId, OPEN_ORACLE_EXTRA_DATA_MAPPING_SLOT) + 1n
		await mockWindow.addStateOverrides({
			[openOracle]: {
				stateDiff: {
					[formatStorageSlot(callbackSlot)]: packOpenOracleExtraCallbackSlot(extraData.callbackContract, extraData.numReports, 1),
				},
			},
		})
		const overriddenExtraData = await getOpenOracleExtraData(client, pendingReportId)
		assert.strictEqual(overriddenExtraData.callbackGasLimit, 1, 'setup should force the settlement callback to fail')

		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await openOracleSettle(client, pendingReportId)
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
		const questionId = getQuestionId(questionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier)
		await approveAndDepositRep(client, repDeposit, questionId)
		const addresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)
		priceOracle = addresses.priceOracleManagerAndOperatorQueuer
		securityPool = addresses.securityPool
	})

	const queueStagedOperation = async (operation: OperationType, targetVault: Address, amount: bigint, validForSeconds: bigint, value = 0n) => await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, operation, targetVault, amount, validForSeconds, value)
	const getInitialReportAmount2ForPrice = (repEthPrice: bigint) => {
		const amount2 = (ORACLE_EXACT_TOKEN1_REPORT * 10n ** 18n) / repEthPrice
		return amount2 > 0n ? amount2 : 1n
	}

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

	test('coordinator constructor rejects unsafe oracle risk parameters', async () => {
		const baseArgs = getOracleCoordinatorConstructorArgs()
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
			escalationHaltMultiplierBps,
			maxSettlementBaseFeeMultiplierBps,
			minLiquidationPriceDistanceBps,
		]
		const invalidRiskParameterCases: Array<{ args: OracleCoordinatorConstructorArgs; message: RegExp }> = [
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
		const lastPrice = await getLastPrice(client, priceOracle)
		const initialReportAmount2 = lastPrice === 0n ? ORACLE_EXACT_TOKEN1_REPORT : (ORACLE_EXACT_TOKEN1_REPORT * 10n ** 18n) / lastPrice || 1n

		// Call requestPrice with overpayment
		await requestPriceWithValue(client, priceOracle, overpayment)

		const finalBalance = await getETHBalance(client, client.account.address)

		// The caller still funds the WETH side of the atomic initial report in addition
		// to the ETH bounty, but any extra ETH value should be refunded.
		const expectedNetCost = ethCost + initialReportAmount2
		assert.strictEqual(initialBalance - finalBalance, expectedNetCost, `Caller should net pay the ETH bounty plus the WETH-side initial report funding (${expectedNetCost}), but paid ${initialBalance - finalBalance}`)
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

	test('invalid settled oracle reports clear pending report without validating price or executing staged allowances', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const unsafeAllowance = repDeposit * 10n

		const invalidAmount2 = ORACLE_EXACT_TOKEN1_REPORT * 10n ** 18n + 1n
		await mockWindow.setBalance(client.account.address, invalidAmount2 + ethCost + 10n ** 18n)
		await requestPriceIfNeededAndStageOperationWithInitialReportAmount2(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, unsafeAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, invalidAmount2, ethCost)

		const pendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(pendingReportId > 0n, 'setup should leave a pending oracle report')

		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await openOracleSettle(client, pendingReportId)

		const isPriceValid = await getIsPriceValid(client, priceOracle)
		const pendingReportIdAfterSettlement = await getPendingReportId(client, priceOracle)
		const pendingOperationSlotId = await getPendingOperationSlotId(client, priceOracle)
		const vault = await getSecurityVault(client, securityPool, client.account.address)

		assert.strictEqual(pendingReportIdAfterSettlement, 0n, 'invalid settled reports must clear the pending report so the oracle can be retried')
		assert.strictEqual(pendingOperationSlotId, 1n, 'invalid settled reports should leave the staged operation pending for a later valid price')
		assert.strictEqual(isPriceValid, false, 'invalid settled reports must not make the price valid')
		assert.strictEqual(vault.securityBondAllowance, 0n, 'invalid oracle prices must not execute staged allowance updates')
		const secondAllowance = repDeposit / 5n

		const balanceBefore = await getETHBalance(client, client.account.address)
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, secondAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		const balanceAfter = await getETHBalance(client, client.account.address)
		const pendingReportIdAfterSecondOperation = await getPendingReportId(client, priceOracle)

		assert.strictEqual(balanceBefore - balanceAfter, 0n, 'unrelated staged operations should not be charged to retry an older pending operation')
		assert.strictEqual(pendingReportIdAfterSecondOperation, 0n, 'unrelated staged operations should not request a report for an older pending slot')

		await requestPrice(client, priceOracle)
		const recoveryPendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(recoveryPendingReportId > 0n, 'oracle state should recover after an invalid settled report clears the pending request')
	})

	test('only the pending report sponsor can queue more operations while settlement is pending', async () => {
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const sponsorAllowance = repDeposit / 4n
		const counterpartyAllowance = repDeposit / 5n

		await approveToken(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRep(counterpartyClient, securityPool, repDeposit)

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, sponsorAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)

		const pendingReportIdBeforeJoin = await getPendingReportId(client, priceOracle)
		const queuedOperationEthCost = await getQueuedOperationEthCost(client, priceOracle)
		const zeroCostJoinRejected = await counterpartyClient
			.simulateContract({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'requestPriceIfNeededAndStageOperation',
				address: priceOracle,
				args: [OperationType.SetSecurityBondsAllowance, counterpartyClient.account.address, counterpartyAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 1n],
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
				args: [OperationType.SetSecurityBondsAllowance, counterpartyClient.account.address, repDeposit / 5n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 1n],
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

		const invalidAmount2 = ORACLE_EXACT_TOKEN1_REPORT * 10n ** 18n + 1n
		await mockWindow.setBalance(client.account.address, invalidAmount2 + ethCost + 10n ** 18n)
		await requestPriceIfNeededAndStageOperationWithInitialReportAmount2(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, unsafeAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, invalidAmount2, ethCost)

		const pendingReportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await openOracleSettle(client, pendingReportId)
		await mockWindow.advanceTime(DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS + 1n)

		await requestPriceWithValue(client, priceOracle, ethCost)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)

		const isPriceValid = await getIsPriceValid(client, priceOracle)
		const pendingOperationSlotId = await getPendingOperationSlotId(client, priceOracle)
		const stagedOperation = await getStagedOperation(client, priceOracle, 1n)
		const vault = await getSecurityVault(client, securityPool, client.account.address)

		assert.strictEqual(isPriceValid, true, 'valid reports should settle even when the pending auto-execute slot expired')
		assert.strictEqual(pendingOperationSlotId, 0n, 'expired pending auto-execute slots should be cleared during callback')
		assert.strictEqual(stagedOperation[1], zeroAddress, 'expired pending auto-execute operations should be consumed')
		assert.strictEqual(vault.securityBondAllowance, 0n, 'expired pending operations must not execute during later valid settlement')
	})

	test('failed OpenOracle settlement callbacks do not leave the coordinator permanently pending', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		await requestPriceWithValue(client, priceOracle, ethCost)

		const pendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(pendingReportId > 0n, 'setup should leave a pending oracle report')

		await settlePendingReportWithFailedCallback(pendingReportId)

		const pendingReportIdAfterSettlement = await getPendingReportId(client, priceOracle)
		assert.strictEqual(pendingReportIdAfterSettlement, pendingReportId, 'failed callbacks should leave recovery work to the coordinator recovery function')

		const recoveryHash = await recoverSettledPendingReport(client, priceOracle)
		const recoveryReceipt = await client.waitForTransactionReceipt({ hash: recoveryHash })

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

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, firstAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, secondAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, queuedOperationEthCost)
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, thirdAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, queuedOperationEthCost)
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, fourthAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, queuedOperationEthCost)
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, fifthAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)

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
		const priceReportedLog = findPriceReportedLog(settleReceipt.logs)
		if (priceReportedLog === undefined) throw new Error('missing PriceReported log')
		const callbackLog = findSettlementCallbackExecutedLog(settleReceipt.logs)
		if (callbackLog === undefined) throw new Error('missing settlement callback execution event')
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
		assert.strictEqual(callbackLog.args.success, true, 'bounded pending operation settlement callback should succeed')
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

	test('aggregate operation notional cannot exceed report security through manual overflow execution', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const queuedOperationEthCost = await getQueuedOperationEthCost(client, priceOracle)
		const reportSecurityNotional = ORACLE_EXACT_TOKEN1_REPORT
		const pendingAllowances = [reportSecurityNotional / 4n, reportSecurityNotional / 2n, (reportSecurityNotional * 3n) / 4n, reportSecurityNotional]

		for (const [index, allowance] of pendingAllowances.entries()) {
			await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, allowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, index === 0 ? ethCost : queuedOperationEthCost)
		}
		const overflowAllowance = reportSecurityNotional + 1n
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, overflowAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		assert.strictEqual((await getSecurityVault(client, securityPool, client.account.address)).securityBondAllowance, reportSecurityNotional, 'auto-executed operations should consume at most the settled report security')
		assert.strictEqual(await getPriceRoundMaxNotional(client, priceOracle), reportSecurityNotional, 'the settled price round should expose the ETH-notional report security')
		assert.strictEqual(await getPriceRoundConsumedNotional(client, priceOracle), reportSecurityNotional, 'aggregate successful operation value should consume the report security exactly')
		assert.strictEqual(await getPriceRoundRemainingNotional(client, priceOracle), 0n, 'the price round should expose no unsecured operation capacity')

		const executionHash = await executeStagedOperation(client, priceOracle, 5n)
		const executionReceipt = await client.waitForTransactionReceipt({ hash: executionHash })
		const executionLog = findExecutedStagedOperationLog(executionReceipt.logs)
		if (executionLog === undefined) throw new Error('missing manual overflow execution log')

		assert.strictEqual(executionLog.args.success, false, 'manual overflow execution must not exceed aggregate report security')
		assert.strictEqual(executionLog.args.errorMessage, 'oracle budget exceeded', 'manual overflow execution should expose the shared notional guard')
		assert.strictEqual((await getSecurityVault(client, securityPool, client.account.address)).securityBondAllowance, reportSecurityNotional, 'rejected manual overflow must preserve the report-secured allowance')
		assert.strictEqual((await getStagedOperation(client, priceOracle, 5n))[1], zeroAddress, 'rejected manual overflow should be consumed')
		assert.strictEqual(await getPriceRoundConsumedNotional(client, priceOracle), reportSecurityNotional, 'rejected overflow must not consume more than the report security')
	})

	test('mixed actual operation value stays within each report budget across callback, manual, and reset paths', async () => {
		const targetClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const sponsorClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const targetRepDeposit = 30n * 10n ** 18n
		const sponsorRepDeposit = 30n * 10n ** 18n
		const firstWithdrawRepAmount = 10n * 10n ** 18n
		const startingAllowance = 3n * 10n ** 18n
		const liquidationDebtRequested = 2n * 10n ** 18n
		const liquidationPrice = 10n * 10n ** 18n
		const pricePrecision = 10n ** 18n
		const ceilRepValue = (repAmount: bigint, price: bigint) => (repAmount * pricePrecision + price - 1n) / price

		await approveToken(targetClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRep(targetClient, securityPool, targetRepDeposit)
		await approveToken(sponsorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRep(sponsorClient, securityPool, sponsorRepDeposit)

		const initialEthCost = await getRequestPriceEthCost(targetClient, priceOracle)
		await requestPriceIfNeededAndStageOperationWithValue(targetClient, priceOracle, OperationType.SetSecurityBondsAllowance, targetClient.account.address, startingAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, initialEthCost)
		await handleOracleReporting(client, mockWindow, priceOracle, pricePrecision, targetClient.account.address)
		const initialRoundId = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'priceRoundId',
			address: priceOracle,
			args: [],
		})
		assert.strictEqual(await getPriceRoundConsumedNotional(client, priceOracle), startingAllowance, 'setup allowance should debit its observed positive delta from the first round')

		await mockWindow.advanceTime(DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS + 1n)
		const requestEthCost = await getRequestPriceEthCost(sponsorClient, priceOracle)
		const queuedOperationEthCost = await getQueuedOperationEthCost(sponsorClient, priceOracle)
		await requestPriceIfNeededAndStageOperationWithInitialReportAmount2(sponsorClient, priceOracle, OperationType.Liquidation, targetClient.account.address, liquidationDebtRequested, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, getInitialReportAmount2ForPrice(liquidationPrice), requestEthCost)
		await requestPriceIfNeededAndStageOperationWithValue(sponsorClient, priceOracle, OperationType.WithdrawRep, sponsorClient.account.address, firstWithdrawRepAmount, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, queuedOperationEthCost)
		await requestPriceIfNeededAndStageOperationWithValue(sponsorClient, priceOracle, OperationType.SetSecurityBondsAllowance, sponsorClient.account.address, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, queuedOperationEthCost)
		await requestPriceIfNeededAndStageOperationWithValue(sponsorClient, priceOracle, OperationType.SetSecurityBondsAllowance, sponsorClient.account.address, 3n * 10n ** 18n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, queuedOperationEthCost)
		await requestPriceIfNeededAndStageOperationWithValue(sponsorClient, priceOracle, OperationType.SetSecurityBondsAllowance, sponsorClient.account.address, repDeposit / 4n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)

		const poolRepBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		const targetVaultBefore = await getSecurityVault(client, securityPool, targetClient.account.address)
		const targetRepBefore = await poolOwnershipToRep(client, securityPool, targetVaultBefore.repDepositShare)
		const pendingReportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		const settlementHash = await openOracleSettle(client, pendingReportId)
		const settlementReceipt = await client.waitForTransactionReceipt({ hash: settlementHash })
		const settledPrice = await getLastPrice(client, priceOracle)

		const poolRepAfter = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		const targetVaultAfter = await getSecurityVault(client, securityPool, targetClient.account.address)
		const sponsorVaultAfter = await getSecurityVault(client, securityPool, sponsorClient.account.address)
		const targetRepAfter = await poolOwnershipToRep(client, securityPool, targetVaultAfter.repDepositShare)
		const actualWithdrawRep = poolRepBefore - poolRepAfter
		const actualDebtMoved = targetVaultBefore.securityBondAllowance - targetVaultAfter.securityBondAllowance
		const actualRepMoved = targetRepBefore - targetRepAfter
		const observedWithdrawalNotional = ceilRepValue(actualWithdrawRep, settledPrice)
		const observedLiquidationRepNotional = ceilRepValue(actualRepMoved, settledPrice)
		const observedLiquidationNotional = actualDebtMoved > observedLiquidationRepNotional ? actualDebtMoved : observedLiquidationRepNotional
		const observedAllowanceIncrease = sponsorVaultAfter.securityBondAllowance - actualDebtMoved
		const observedSuccessfulNotional = observedWithdrawalNotional + observedLiquidationNotional + observedAllowanceIncrease
		const roundMaxNotional = await getPriceRoundMaxNotional(client, priceOracle)
		const roundConsumedNotional = await getPriceRoundConsumedNotional(client, priceOracle)
		assert.strictEqual(roundConsumedNotional, observedSuccessfulNotional, 'round consumption should equal value derived from actual withdrawal and liquidation deltas')
		assert.ok(roundConsumedNotional <= roundMaxNotional, 'mixed successful actual value must not exceed report security')

		const callbackLogs = findExecutedStagedOperationLogs(settlementReceipt.logs)
		const liquidationLog = callbackLogs.find(log => log?.args.operationId === 2n)
		if (liquidationLog === undefined) throw new Error('missing mixed-operation liquidation log')
		assert.strictEqual(liquidationLog.args.success, true, `mixed-operation liquidation should succeed: ${liquidationLog.args.errorMessage}`)
		const invalidAllowanceLog = callbackLogs.find(log => log?.args.operationId === 4n)
		if (invalidAllowanceLog === undefined) throw new Error('missing invalid mixed-operation allowance log')
		assert.strictEqual(invalidAllowanceLog.args.success, false, 'the below-minimum callback allowance should fail without debiting the round')
		assert.strictEqual(invalidAllowanceLog.args.errorMessage, 'Bond min', 'the failed callback allowance should expose its underlying minimum-debt failure')

		const consumedBeforeManualOverflow = await getPriceRoundConsumedNotional(client, priceOracle)
		const manualOverflowHash = await executeStagedOperation(client, priceOracle, 6n)
		const manualOverflowReceipt = await client.waitForTransactionReceipt({ hash: manualOverflowHash })
		const manualOverflowLog = findExecutedStagedOperationLog(manualOverflowReceipt.logs)
		if (manualOverflowLog === undefined) throw new Error('missing mixed-operation manual overflow log')
		assert.strictEqual(manualOverflowLog.args.success, false, 'manual overflow should fail against remaining mixed-operation budget')
		assert.strictEqual(manualOverflowLog.args.errorMessage, 'oracle budget exceeded', 'manual overflow should use the shared round budget guard')
		assert.strictEqual(await getPriceRoundConsumedNotional(client, priceOracle), consumedBeforeManualOverflow, 'failed manual overflow must not debit the round')

		await mockWindow.advanceTime(DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS + 1n)
		const allowanceBeforeResetRound = (await getSecurityVault(client, securityPool, targetClient.account.address)).securityBondAllowance
		const nextAllowance = allowanceBeforeResetRound + 1n * 10n ** 18n
		const resetRoundEthCost = await getRequestPriceEthCost(targetClient, priceOracle)
		await requestPriceIfNeededAndStageOperationWithInitialReportAmount2(targetClient, priceOracle, OperationType.SetSecurityBondsAllowance, targetClient.account.address, nextAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, getInitialReportAmount2ForPrice(pricePrecision), resetRoundEthCost)
		await handleOracleReporting(client, mockWindow, priceOracle, pricePrecision, targetClient.account.address)
		const resetRoundId = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'priceRoundId',
			address: priceOracle,
			args: [],
		})
		assert.strictEqual(resetRoundId, initialRoundId + 2n, 'a fresh report should reset accounting into a distinct third price round')
		assert.strictEqual(await getPriceRoundConsumedNotional(client, priceOracle), nextAllowance - allowanceBeforeResetRound, 'new price round should debit only its observed allowance increase')
		assert.ok((await getPriceRoundConsumedNotional(client, priceOracle)) <= (await getPriceRoundMaxNotional(client, priceOracle)), 'reset round should independently remain within report security')
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
		const withdrawingClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const withdrawableRep = 100n * 10n ** 18n
		await approveToken(withdrawingClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRep(withdrawingClient, securityPool, withdrawableRep)
		await requestPrice(withdrawingClient, priceOracle)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n, withdrawingClient.account.address)

		const oversizedWithdrawal = repDeposit * 10n
		await requestPriceIfNeededAndStageOperationWithValue(withdrawingClient, priceOracle, OperationType.WithdrawRep, withdrawingClient.account.address, oversizedWithdrawal, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)

		const vaultAfterWithdrawal = await getSecurityVault(client, securityPool, withdrawingClient.account.address)
		assert.strictEqual(vaultAfterWithdrawal.repDepositShare, 0n, 'over-requested withdrawal should still withdraw the full vault balance')
	})

	test('pending withdrawals that become zero-effect during execution fail without blocking the successful withdrawal', async () => {
		const withdrawingClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const withdrawableRep = 100n * 10n ** 18n
		await approveToken(withdrawingClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRep(withdrawingClient, securityPool, withdrawableRep)
		const ethCost = await getRequestPriceEthCost(withdrawingClient, priceOracle)
		const queuedOperationEthCost = await getQueuedOperationEthCost(withdrawingClient, priceOracle)

		await requestPriceIfNeededAndStageOperationWithValue(withdrawingClient, priceOracle, OperationType.WithdrawRep, withdrawingClient.account.address, withdrawableRep, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await requestPriceIfNeededAndStageOperationWithValue(withdrawingClient, priceOracle, OperationType.WithdrawRep, withdrawingClient.account.address, withdrawableRep, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, queuedOperationEthCost)

		const { settleReceipt } = await settlePendingReportWithPrice(10n ** 18n)

		const vaultAfterSettlement = await getSecurityVault(client, securityPool, withdrawingClient.account.address)
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

		await requestPriceIfNeededAndStageOperationWithInitialReportAmount2(liquidatorClient, priceOracle, OperationType.Liquidation, client.account.address, liquidationAmount, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, getInitialReportAmount2ForPrice(nearThresholdPrice), ethCost)
		await handleOracleReporting(client, mockWindow, priceOracle, nearThresholdPrice, liquidatorClient.account.address)

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
