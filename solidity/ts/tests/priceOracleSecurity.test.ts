import { test, beforeEach, describe, setDefaultTimeout } from 'bun:test'
import assert from 'node:assert/strict'
import { decodeEventLog, encodeDeployData, type Address, type Hex, zeroAddress } from 'viem'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, DAY, WETH_ADDRESS } from '../testsuite/simulator/utils/constants'
import { addressString, dateToBigintSeconds } from '../testsuite/simulator/utils/bigint'
import { approveToken, setupTestAccounts, getERC20Balance, getETHBalance } from '../testsuite/simulator/utils/utilities'
import { approveAndDepositRep } from '../testsuite/simulator/utils/contracts/peripheralsTestUtils'
import { handleOracleReporting } from '../testsuite/simulator/utils/contracts/peripheralsTestUtils'
import { deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { createQuestion, getQuestionId } from '../testsuite/simulator/utils/contracts/zoltarQuestionData'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar'
import {
	OperationType,
	executeStagedOperation,
	getActiveStagedOperationCount,
	getActiveStagedOperations,
	getIsPriceValid,
	getOpenOracleExtraData,
	getOpenOracleReportMeta,
	getPendingOperationSlotId,
	getPendingReportId,
	getPendingReportMaxSettlementBaseFee,
	getPriceRoundConsumedNotional,
	getPriceRoundRemainingNotional,
	getRequestPriceEthCost,
	getStagedOperation,
	openOracleSettle,
	openOracleSettleWithGasPrice,
	openOracleSubmitInitialReport,
	requestPrice,
	requestPriceIfNeededAndStageOperation,
	requestPriceWithValue,
	wrapWeth,
} from '../testsuite/simulator/utils/contracts/peripherals'
import { depositRep, getSecurityVault } from '../testsuite/simulator/utils/contracts/securityPool'
import { peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator } from '../types/contractArtifact'
import { isIgnorableLogDecodeError } from './logDecodeErrors'

setDefaultTimeout(TEST_TIMEOUT_MS)

type TransactionReceiptLogs = Awaited<ReturnType<WriteClient['waitForTransactionReceipt']>>['logs']

const findExecutedStagedOperationLog = (logs: TransactionReceiptLogs) =>
	logs
		.map(log => {
			try {
				return decodeEventLog({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					data: log.data,
					topics: log.topics,
				})
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				return undefined
			}
		})
		.find(log => log?.eventName === 'ExecutedStagedOperation')

type OracleCoordinatorConstructorArgs = [Address, Address, Address, bigint, number, bigint, number, number, number, number, number, boolean, boolean, Address, bigint, bigint, bigint, bigint]

function encodeOracleCoordinatorDeployData(args: OracleCoordinatorConstructorArgs) {
	return encodeDeployData({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		bytecode: `0x${peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.evm.bytecode.object}`,
		args,
	})
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
	const MAX_RETENTION_RATE = 999_999_996_848_000_000n
	const EXTRA_INFO = 'test question!'
	let securityPool: Address
	const ORACLE_REPORT_GAS = 100000n
	const ORACLE_SETTLEMENT_GAS = 1000000
	const ORACLE_EXACT_TOKEN1_REPORT = 250n * 10n ** 18n
	const ORACLE_SETTLEMENT_TIME = 40 * 12
	const ORACLE_DISPUTE_DELAY = 0
	const ORACLE_PROTOCOL_FEE = 100000
	const ORACLE_FEE_PERCENTAGE = 10000
	const ORACLE_MULTIPLIER = 115
	const ORACLE_TIME_TYPE = true
	const ORACLE_TRACK_DISPUTES = true
	const ORACLE_PRICE_ROUND_BUDGET_MULTIPLIER_BPS = 40000n
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
		ORACLE_PRICE_ROUND_BUDGET_MULTIPLIER_BPS,
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
		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier, MAX_RETENTION_RATE)
		await approveAndDepositRep(client, repDeposit, questionId)
		const addresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)
		priceOracle = addresses.priceOracleManagerAndOperatorQueuer
		securityPool = addresses.securityPool
	})

	test('coordinator constructor rejects unsafe oracle risk parameters', async () => {
		const baseArgs = getOracleCoordinatorConstructorArgs()
		const buildArgsWithRiskParameters = (priceRoundBudgetMultiplierBps: bigint, escalationHaltMultiplierBps: bigint, maxSettlementBaseFeeMultiplierBps: bigint, minLiquidationPriceDistanceBps: bigint): OracleCoordinatorConstructorArgs => [
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
			priceRoundBudgetMultiplierBps,
			escalationHaltMultiplierBps,
			maxSettlementBaseFeeMultiplierBps,
			minLiquidationPriceDistanceBps,
		]
		const invalidRiskParameterCases: Array<{ args: OracleCoordinatorConstructorArgs; message: RegExp }> = [
			{
				args: buildArgsWithRiskParameters(0n, ORACLE_ESCALATION_HALT_MULTIPLIER_BPS, ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS, ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS),
				message: /price budget multiplier is zero/i,
			},
			{
				args: buildArgsWithRiskParameters(ORACLE_PRICE_ROUND_BUDGET_MULTIPLIER_BPS, 0n, ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS, ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS),
				message: /escalation halt multiplier is zero/i,
			},
			{
				args: buildArgsWithRiskParameters(ORACLE_PRICE_ROUND_BUDGET_MULTIPLIER_BPS, ORACLE_ESCALATION_HALT_MULTIPLIER_BPS, 9999n, ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS),
				message: /base fee multiplier too low/i,
			},
			{
				args: buildArgsWithRiskParameters(ORACLE_PRICE_ROUND_BUDGET_MULTIPLIER_BPS, ORACLE_ESCALATION_HALT_MULTIPLIER_BPS, ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS, 10001n),
				message: /liquidation distance too high/i,
			},
		]

		for (const invalidCase of invalidRiskParameterCases) {
			await assert.rejects(async () => await deployContract(encodeOracleCoordinatorDeployData(invalidCase.args)), invalidCase.message)
		}
	})

	test('oracle settlement skips price updates and staged execution when settlement basefee is too high', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const unsafeAllowance = repDeposit / 4n

		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, unsafeAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)

		const pendingReportId = await getPendingReportId(client, priceOracle)
		const pendingMaxSettlementBaseFee = await getPendingReportMaxSettlementBaseFee(client, priceOracle)
		assert.ok(pendingReportId > 0n, 'setup should leave a pending oracle report')
		assert.strictEqual(pendingMaxSettlementBaseFee, 0n, 'zero-basefee request should only settle under zero basefee')

		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
		const amount1 = reportMeta.exactToken1Report
		const amount2 = amount1
		const openOracle = getInfraContractAddresses().openOracle
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
		await approveToken(client, WETH_ADDRESS, openOracle)
		await mockWindow.setBalance(client.account.address, amount2 * 2n)
		await wrapWeth(client, amount2)
		const stateHash = (await getOpenOracleExtraData(client, pendingReportId)).stateHash
		await openOracleSubmitInitialReport(client, pendingReportId, amount1, amount2, stateHash)
		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: ['0x1'] })
		await openOracleSettleWithGasPrice(client, pendingReportId, 1n)
		await mockWindow.setNextBlockBaseFeePerGasToZero()

		const isPriceValid = await getIsPriceValid(client, priceOracle)
		const pendingReportIdAfterSettlement = await getPendingReportId(client, priceOracle)
		const pendingMaxSettlementBaseFeeAfterSettlement = await getPendingReportMaxSettlementBaseFee(client, priceOracle)
		const pendingOperationSlotId = await getPendingOperationSlotId(client, priceOracle)
		const stagedOperation = await getStagedOperation(client, priceOracle, 1n)
		const vault = await getSecurityVault(client, securityPool, client.account.address)

		assert.strictEqual(isPriceValid, false, 'high-basefee settlement must not validate the price')
		assert.strictEqual(pendingReportIdAfterSettlement, 0n, 'high-basefee settlement should clear the stale pending report')
		assert.strictEqual(pendingMaxSettlementBaseFeeAfterSettlement, 0n, 'high-basefee settlement should clear the basefee guard')
		assert.strictEqual(pendingOperationSlotId, 1n, 'high-basefee settlement should leave the auto-execute slot pending for a future valid price')
		assert.strictEqual(stagedOperation[1], client.account.address, 'high-basefee settlement must not consume staged operations')
		assert.strictEqual(vault.securityBondAllowance, 0n, 'high-basefee settlement must not execute staged allowance updates')

		await requestPrice(client, priceOracle)
		const recoveryPendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(recoveryPendingReportId > 0n, 'oracle state should recover after a high-basefee settlement clears the report')
	})

	test('requestPrice should refund excess Ether when overpaid', async () => {
		// Test that overpayment is refunded, not kept by contract
		const initialBalance = await getETHBalance(client, client.account.address)
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const overpayment = ethCost * 2n

		// Call requestPrice with overpayment
		await requestPriceWithValue(client, priceOracle, overpayment)

		const finalBalance = await getETHBalance(client, client.account.address)

		// With bug: finalBalance = initialBalance - overpayment (excess not refunded)
		// With fix: finalBalance = initialBalance - ethCost (excess refunded)
		const expectedNetCost = ethCost
		assert.strictEqual(initialBalance - finalBalance, expectedNetCost, `Caller should net pay only ethCost (${ethCost}), but paid ${initialBalance - finalBalance}`)
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
		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.WithdrawRep, caller, 100n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, sendValue)

		// After the call, the pre-existing balance should remain intact.
		// The contract should have retained ethCost (to pay OpenOracle) and refunded the excess (sendValue - ethCost).
		// Final balance = preBalance (unchanged)
		const balanceAfter = await getETHBalance(client, priceOracle)
		assert.strictEqual(balanceAfter, preBalance, `Contract should retain preexisting balance (${preBalance}) after requestPriceIfNeededAndStageOperation, but it was drained to ${balanceAfter}`)
	})

	test('failed staged operations are consumed after oracle settlement', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const impossibleAllowance = repDeposit * 10n

		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, impossibleAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)

		const pendingOperationSlotId = await getPendingOperationSlotId(client, priceOracle)
		const stagedOperation = await getStagedOperation(client, priceOracle, 1n)

		assert.strictEqual(pendingOperationSlotId, 0n, 'failed auto-executed operations should clear the pending slot')
		assert.strictEqual(stagedOperation[1], zeroAddress, 'failed staged operations should be consumed after their first execution attempt')
		assert.strictEqual(stagedOperation[3], impossibleAllowance, 'failed staged operations should retain their record for auditability')

		await assert.rejects(async () => await executeStagedOperation(client, priceOracle, 1n), /no such operation/i)
	})

	test('invalid settled oracle reports clear pending report without validating price or executing staged allowances', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const unsafeAllowance = repDeposit * 10n

		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, unsafeAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)

		const pendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(pendingReportId > 0n, 'setup should leave a pending oracle report')

		const openOracle = getInfraContractAddresses().openOracle
		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
		const amount1 = reportMeta.exactToken1Report
		const amount2 = amount1 * 10n ** 18n + 1n
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
		await approveToken(client, WETH_ADDRESS, openOracle)
		await mockWindow.setBalance(client.account.address, amount2 * 2n)
		const wethBalanceBefore = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
		await wrapWeth(client, amount2)
		const wethBalanceAfter = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
		assert.strictEqual(wethBalanceAfter - wethBalanceBefore, amount2, 'setup should wrap enough WETH for the invalid report')

		const stateHash = (await getOpenOracleExtraData(client, pendingReportId)).stateHash
		await openOracleSubmitInitialReport(client, pendingReportId, amount1, amount2, stateHash)
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
		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, secondAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		const balanceAfter = await getETHBalance(client, client.account.address)
		const pendingReportIdAfterSecondOperation = await getPendingReportId(client, priceOracle)

		assert.strictEqual(balanceBefore - balanceAfter, 0n, 'unrelated staged operations should not be charged to retry an older pending operation')
		assert.strictEqual(pendingReportIdAfterSecondOperation, 0n, 'unrelated staged operations should not request a report for an older pending slot')

		await requestPrice(client, priceOracle)
		const recoveryPendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(recoveryPendingReportId > 0n, 'oracle state should recover after an invalid settled report clears the pending request')
	})

	test('expired pending auto-execute slots do not block later valid oracle settlements', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const unsafeAllowance = repDeposit * 10n

		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, unsafeAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)

		const pendingReportId = await getPendingReportId(client, priceOracle)
		const openOracle = getInfraContractAddresses().openOracle
		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
		const amount1 = reportMeta.exactToken1Report
		const amount2 = amount1 * 10n ** 18n + 1n
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
		await approveToken(client, WETH_ADDRESS, openOracle)
		await mockWindow.setBalance(client.account.address, amount2 * 2n)
		await wrapWeth(client, amount2)
		const stateHash = (await getOpenOracleExtraData(client, pendingReportId)).stateHash
		await openOracleSubmitInitialReport(client, pendingReportId, amount1, amount2, stateHash)
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

	test('active staged operations stay newest-first after pending-slot settlement and manual execution', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const firstAllowance = repDeposit / 4n
		const secondAllowance = repDeposit / 5n
		const thirdAllowance = repDeposit / 6n
		const fourthAllowance = repDeposit / 7n

		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, firstAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, secondAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, thirdAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, fourthAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)

		const pendingOperationSlotId = await getPendingOperationSlotId(client, priceOracle)
		const activeStagedOperationCount = await getActiveStagedOperationCount(client, priceOracle)
		const [operationIds, activeOperations] = await getActiveStagedOperations(client, priceOracle, 0n, 4n)
		assert.strictEqual(pendingOperationSlotId, 1n, 'first queued self operation should keep the auto-execute slot')
		assert.strictEqual(activeStagedOperationCount, 4n, 'active staged operation count should track pending and manual operations')
		assert.deepStrictEqual(Array.from(operationIds), [4n, 3n, 2n, 1n], 'active staged operations should enumerate newest queued operations first')
		assert.strictEqual(activeOperations[0]?.amount, fourthAllowance, 'newest enumerated operation should retain its amount')
		assert.strictEqual(activeOperations[1]?.amount, thirdAllowance, 'second newest enumerated operation should retain its amount')
		assert.strictEqual(activeOperations[2]?.amount, secondAllowance, 'third newest enumerated operation should retain its amount')
		assert.strictEqual(activeOperations[3]?.amount, firstAllowance, 'oldest enumerated operation should retain its amount')

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await executeStagedOperation(client, priceOracle, 3n)
		const updatedActiveStagedOperationCount = await getActiveStagedOperationCount(client, priceOracle)
		const [remainingOperationIds, remainingOperations] = await getActiveStagedOperations(client, priceOracle, 0n, 4n)

		const stagedOperation1 = await getStagedOperation(client, priceOracle, 1n)
		const stagedOperation2 = await getStagedOperation(client, priceOracle, 2n)
		const stagedOperation3 = await getStagedOperation(client, priceOracle, 3n)
		const stagedOperation4 = await getStagedOperation(client, priceOracle, 4n)
		assert.strictEqual(stagedOperation1[1], zeroAddress, 'pending-slot operation should be consumed after the oracle settles it')
		assert.strictEqual(stagedOperation2[1], client.account.address, 'older still-active operations should remain staged after newer manual execution')
		assert.strictEqual(stagedOperation3[1], zeroAddress, 'manually executed middle operations should be consumed after success')
		assert.strictEqual(stagedOperation4[1], client.account.address, 'newest operations should remain active when older manual operations are consumed')
		assert.strictEqual(stagedOperation4[3], fourthAllowance, 'newest operations should retain their requested amount until execution')
		assert.strictEqual(updatedActiveStagedOperationCount, 2n, 'active staged operation count should shrink as operations are consumed')
		assert.deepStrictEqual(Array.from(remainingOperationIds), [4n, 2n], 'active staged operations should stay newest first after middle entries are consumed')
		assert.strictEqual(remainingOperations[0]?.amount, fourthAllowance, 'remaining newest operation should stay first in the preview')
		assert.strictEqual(remainingOperations[1]?.amount, secondAllowance, 'older remaining operation should stay second in the preview')
	})

	test('one oracle price round cannot authorize operations beyond its shared protocol budget', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const budgetConsumingAllowance = 900n * 10n ** 18n
		const budgetExceedingAllowance = 1050n * 10n ** 18n

		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, budgetConsumingAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, budgetExceedingAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)

		const consumedAfterAutoExecution = await getPriceRoundConsumedNotional(client, priceOracle)
		const remainingAfterAutoExecution = await getPriceRoundRemainingNotional(client, priceOracle)
		assert.strictEqual(consumedAfterAutoExecution, budgetConsumingAllowance, 'auto-executed operation should consume price-round budget')
		assert.strictEqual(remainingAfterAutoExecution, 100n * 10n ** 18n, 'remaining budget should be shared by all operations using this price')

		await executeStagedOperation(client, priceOracle, 2n)

		const vault = await getSecurityVault(client, securityPool, client.account.address)
		const consumedAfterBudgetFailure = await getPriceRoundConsumedNotional(client, priceOracle)
		const secondStagedOperation = await getStagedOperation(client, priceOracle, 2n)

		assert.strictEqual(vault.securityBondAllowance, budgetConsumingAllowance, 'budget-exceeded operation must not change vault exposure')
		assert.strictEqual(consumedAfterBudgetFailure, budgetConsumingAllowance, 'failed budget checks must not consume additional budget')
		assert.strictEqual(secondStagedOperation[1], zeroAddress, 'budget-exceeded operations should be consumed as failed staged operations')

		const incrementalAllowance = 950n * 10n ** 18n
		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, incrementalAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		const consumedAfterIncrement = await getPriceRoundConsumedNotional(client, priceOracle)
		assert.strictEqual(consumedAfterIncrement, 950n * 10n ** 18n, 'allowance increases should only consume incremental exposure')

		const budgetExhaustingWithdrawal = 50n * 10n ** 18n
		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.WithdrawRep, client.account.address, budgetExhaustingWithdrawal, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		const remainingAfterBudgetExhaustingWithdrawal = await getPriceRoundRemainingNotional(client, priceOracle)
		assert.strictEqual(remainingAfterBudgetExhaustingWithdrawal, 0n, 'test setup should exhaust the price-round budget')

		const reducedAllowance = 925n * 10n ** 18n
		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, reducedAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		const consumedAfterReduction = await getPriceRoundConsumedNotional(client, priceOracle)
		const vaultAfterReduction = await getSecurityVault(client, securityPool, client.account.address)
		assert.strictEqual(consumedAfterReduction, 1000n * 10n ** 18n, 'allowance reductions should not consume price-round budget')
		assert.strictEqual(vaultAfterReduction.securityBondAllowance, reducedAllowance, 'allowance reductions should still execute while the price is fresh, even after the budget is exhausted')
	})

	test('liquidations too close to the threshold are rejected even when oracle budget remains', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const targetAllowance = 75n * 10n ** 18n
		const liquidationAmount = 10n * 10n ** 18n
		const nearThresholdPrice = 7n * 10n ** 18n
		const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRep(liquidatorClient, securityPool, repDeposit)

		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, targetAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await mockWindow.advanceTime(DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS + 1n)

		await requestPriceIfNeededAndStageOperation(liquidatorClient, priceOracle, OperationType.Liquidation, client.account.address, liquidationAmount, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await handleOracleReporting(client, mockWindow, priceOracle, nearThresholdPrice)

		const targetVault = await getSecurityVault(client, securityPool, client.account.address)
		const liquidatorVault = await getSecurityVault(client, securityPool, liquidatorClient.account.address)
		const consumedNotional = await getPriceRoundConsumedNotional(client, priceOracle)
		const stagedOperation = await getStagedOperation(client, priceOracle, 2n)

		assert.strictEqual(targetVault.securityBondAllowance, targetAllowance, 'near-threshold liquidations must not reduce the target vault allowance')
		assert.strictEqual(liquidatorVault.securityBondAllowance, 0n, 'near-threshold liquidations must not move debt to the liquidator vault')
		assert.strictEqual(consumedNotional, 0n, 'near-threshold liquidation failures must not consume price-round budget')
		assert.strictEqual(stagedOperation[1], zeroAddress, 'near-threshold liquidation attempts should be consumed as failed staged operations')
	})

	test('staged operations can only be executed once', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const successfulAllowance = repDeposit / 4n

		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.Liquidation, client.account.address, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, successfulAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await executeStagedOperation(client, priceOracle, 2n)

		await assert.rejects(async () => await executeStagedOperation(client, priceOracle, 2n), /no such operation/i)
	})

	test('non-liquidation staged operations require the initiator vault as target', async () => {
		const otherVault = addressString(TEST_ADDRESSES[1])
		const nonLiquidationOperations = [OperationType.WithdrawRep, OperationType.SetSecurityBondsAllowance]

		for (const operation of nonLiquidationOperations) {
			await assert.rejects(async () => await requestPriceIfNeededAndStageOperation(client, priceOracle, operation, otherVault, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n), /self operation target must match initiator/i)
		}
	})

	test('staged liquidations expire after their caller-selected validity window', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const liquidationTimeoutSeconds = 60n
		const targetVault = addressString(TEST_ADDRESSES[1])

		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.Liquidation, targetVault, 1n, liquidationTimeoutSeconds, ethCost)
		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.Liquidation, targetVault, 1n, liquidationTimeoutSeconds, 0n)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await mockWindow.advanceTime(liquidationTimeoutSeconds + 1n)
		await requestPriceWithValue(client, priceOracle, ethCost)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)

		const expiredExecutionHash = await executeStagedOperation(client, priceOracle, 2n)
		const expiredOperation = await getStagedOperation(client, priceOracle, 2n)
		const expiredExecutionReceipt = await client.waitForTransactionReceipt({ hash: expiredExecutionHash })
		const executionLog = findExecutedStagedOperationLog(expiredExecutionReceipt.logs)
		if (executionLog === undefined) throw new Error('missing expired liquidation execution event')
		assert.strictEqual(expiredOperation[1], zeroAddress, 'expired liquidation should be consumed after execution attempt')
		assert.strictEqual(executionLog.args.operationId, 2n)
		assert.strictEqual(executionLog.args.operation, OperationType.Liquidation)
		assert.strictEqual(executionLog.args.success, false)
		assert.strictEqual(executionLog.args.errorMessage, 'staged operation expired')
	})

	test('staged self operations expire after their caller-selected validity window', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const selfOperationTimeoutSeconds = 60n

		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.Liquidation, client.account.address, 1n, selfOperationTimeoutSeconds, ethCost)
		await requestPriceIfNeededAndStageOperation(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, 1n, selfOperationTimeoutSeconds, 0n)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await mockWindow.advanceTime(selfOperationTimeoutSeconds + 1n)
		await requestPriceWithValue(client, priceOracle, ethCost)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)

		const expiredExecutionHash = await executeStagedOperation(client, priceOracle, 2n)
		const expiredOperation = await getStagedOperation(client, priceOracle, 2n)
		const expiredExecutionReceipt = await client.waitForTransactionReceipt({ hash: expiredExecutionHash })
		const executionLog = findExecutedStagedOperationLog(expiredExecutionReceipt.logs)
		if (executionLog === undefined) throw new Error('missing expired self-operation execution event')
		assert.strictEqual(expiredOperation[1], zeroAddress, 'expired self operation should be consumed after execution attempt')
		assert.strictEqual(executionLog.args.operationId, 2n)
		assert.strictEqual(executionLog.args.operation, OperationType.SetSecurityBondsAllowance)
		assert.strictEqual(executionLog.args.success, false)
		assert.strictEqual(executionLog.args.errorMessage, 'staged operation expired')
	})
})
