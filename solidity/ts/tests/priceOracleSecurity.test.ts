import { test, beforeEach, describe, setDefaultTimeout } from 'bun:test'
import assert from 'node:assert/strict'
import { decodeEventLog, type Address, zeroAddress } from 'viem'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient, writeContractAndWait } from '../testsuite/simulator/utils/viem'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, DAY, WETH_ADDRESS } from '../testsuite/simulator/utils/constants'
import { addressString, dateToBigintSeconds } from '../testsuite/simulator/utils/bigint'
import { approveToken, setupTestAccounts, getERC20Balance, getETHBalance } from '../testsuite/simulator/utils/utilities'
import { approveAndDepositRep } from '../testsuite/simulator/utils/contracts/peripheralsTestUtils'
import { handleOracleReporting } from '../testsuite/simulator/utils/contracts/peripheralsTestUtils'
import { deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { createQuestion, getQuestionId } from '../testsuite/simulator/utils/contracts/zoltarQuestionData'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar'
import { OperationType, getOpenOracleExtraData, getOpenOracleReportMeta, getRequestPriceEthCost, openOracleSettle, openOracleSubmitInitialReport, wrapWeth } from '../testsuite/simulator/utils/contracts/peripherals'
import { getSecurityVault } from '../testsuite/simulator/utils/contracts/securityPool'
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

describe('Price Oracle Refund Security Tests', () => {
	const DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS = 30n * 60n
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

	const queueStagedOperation = async (operation: OperationType, targetVault: Address, amount: bigint, validForSeconds: bigint, value = 0n) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'requestPriceIfNeededAndStageOperation',
					args: [operation, targetVault, amount, validForSeconds],
					value,
				}),
		)

	const fillPendingSettlementOperationList = async (ethCost: bigint, validForSeconds: bigint) => {
		for (let index = 0; index < 4; index++) {
			await queueStagedOperation(OperationType.SetSecurityBondsAllowance, client.account.address, BigInt(index + 1), validForSeconds, index === 0 ? ethCost : 0n)
		}
	}

	test('requestPrice should refund excess Ether when overpaid', async () => {
		// Test that overpayment is refunded, not kept by contract
		const initialBalance = await getETHBalance(client, client.account.address)
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const overpayment = ethCost * 2n

		// Call requestPrice with overpayment
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'requestPrice',
					value: overpayment,
				}),
		)

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
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'requestPriceIfNeededAndStageOperation',
					args: [OperationType.WithdrawRep, caller, 100n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS],
					value: sendValue,
				}),
		)

		// After the call, the pre-existing balance should remain intact.
		// The contract should have retained ethCost (to pay OpenOracle) and refunded the excess (sendValue - ethCost).
		// Final balance = preBalance (unchanged)
		const balanceAfter = await getETHBalance(client, priceOracle)
		assert.strictEqual(balanceAfter, preBalance, `Contract should retain preexisting balance (${preBalance}) after requestPriceIfNeededAndStageOperation, but it was drained to ${balanceAfter}`)
	})

	test('failed staged operations are consumed after oracle settlement', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const impossibleAllowance = repDeposit * 10n

		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'requestPriceIfNeededAndStageOperation',
					args: [OperationType.SetSecurityBondsAllowance, client.account.address, impossibleAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS],
					value: ethCost,
				}),
		)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)

		const pendingOperationSlotId = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'pendingOperationSlotId',
			args: [],
		})

		const stagedOperation = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'stagedOperations',
			args: [1n],
		})

		assert.strictEqual(pendingOperationSlotId, 0n, 'failed auto-executed operations should clear the pending slot')
		assert.strictEqual(stagedOperation[1], zeroAddress, 'failed staged operations should be consumed after their first execution attempt')
		assert.strictEqual(stagedOperation[3], impossibleAllowance, 'failed staged operations should retain their record for auditability')

		await assert.rejects(
			async () =>
				await writeContractAndWait(
					client,
					async () =>
						await client.writeContract({
							abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
							address: priceOracle,
							functionName: 'executeStagedOperation',
							args: [1n],
						}),
				),
			/no such operation/i,
		)
	})

	test('invalid settled oracle reports clear pending report without validating price or executing staged allowances', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const unsafeAllowance = repDeposit * 10n

		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'requestPriceIfNeededAndStageOperation',
					args: [OperationType.SetSecurityBondsAllowance, client.account.address, unsafeAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS],
					value: ethCost,
				}),
		)

		const pendingReportId = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'pendingReportId',
			args: [],
		})
		assert.ok(pendingReportId > 0n, 'setup should leave a pending oracle report')

		const openOracle = getInfraContractAddresses().openOracle
		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
		const amount1 = reportMeta.exactToken1Report
		const amount2 = amount1 * 10n ** 18n + 1n
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
		await approveToken(client, WETH_ADDRESS, openOracle)
		const wethBalanceBefore = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
		await wrapWeth(client, amount2)
		const wethBalanceAfter = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
		assert.strictEqual(wethBalanceAfter - wethBalanceBefore, amount2, 'setup should wrap enough WETH for the invalid report')

		const stateHash = (await getOpenOracleExtraData(client, pendingReportId)).stateHash
		await openOracleSubmitInitialReport(client, pendingReportId, amount1, amount2, stateHash)
		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await openOracleSettle(client, pendingReportId)

		const isPriceValid = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'isPriceValid',
			args: [],
		})
		const pendingReportIdAfterSettlement = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'pendingReportId',
			args: [],
		})
		const pendingOperationSlotId = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'pendingOperationSlotId',
			args: [],
		})
		const vault = await getSecurityVault(client, securityPool, client.account.address)

		assert.strictEqual(pendingReportIdAfterSettlement, 0n, 'invalid settled reports must clear the pending report so the oracle can be retried')
		assert.strictEqual(pendingOperationSlotId, 1n, 'invalid settled reports should leave the staged operation pending for a later valid price')
		assert.strictEqual(isPriceValid, false, 'invalid settled reports must not make the price valid')
		assert.strictEqual(vault.securityBondAllowance, 0n, 'invalid oracle prices must not execute staged allowance updates')
	})

	test('settlement auto-executes a bounded pending operation list and leaves overflow manual', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const firstAllowance = repDeposit / 4n
		const secondAllowance = repDeposit / 5n
		const thirdAllowance = repDeposit / 6n
		const fourthAllowance = repDeposit / 7n
		const fifthAllowance = repDeposit / 8n

		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'requestPriceIfNeededAndStageOperation',
					args: [OperationType.SetSecurityBondsAllowance, client.account.address, firstAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS],
					value: ethCost,
				}),
		)
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'requestPriceIfNeededAndStageOperation',
					args: [OperationType.SetSecurityBondsAllowance, client.account.address, secondAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS],
				}),
		)
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'requestPriceIfNeededAndStageOperation',
					args: [OperationType.SetSecurityBondsAllowance, client.account.address, thirdAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS],
				}),
		)
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'requestPriceIfNeededAndStageOperation',
					args: [OperationType.SetSecurityBondsAllowance, client.account.address, fourthAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS],
				}),
		)
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'requestPriceIfNeededAndStageOperation',
					args: [OperationType.SetSecurityBondsAllowance, client.account.address, fifthAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS],
				}),
		)

		const pendingOperationSlotId = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'pendingOperationSlotId',
			args: [],
		})
		const pendingSettlementOperationCount = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'getPendingSettlementOperationCount',
			args: [],
		})
		const pendingSettlementOperationIds = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'getPendingSettlementOperationIds',
			args: [],
		})
		const activeStagedOperationCount = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'getActiveStagedOperationCount',
			args: [],
		})
		const [operationIds, activeOperations] = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'getActiveStagedOperations',
			args: [0n, 5n],
		})
		assert.strictEqual(pendingOperationSlotId, 1n, 'first queued self operation should remain the compatibility pending slot')
		assert.strictEqual(pendingSettlementOperationCount, 4n, 'pending settlement operation count should cap the auto-execute list')
		assert.deepStrictEqual(Array.from(pendingSettlementOperationIds), [1n, 2n, 3n, 4n], 'pending settlement operations should stay in queue order')
		assert.strictEqual(activeStagedOperationCount, 5n, 'active staged operation count should track pending and manual operations')
		assert.deepStrictEqual(Array.from(operationIds), [5n, 4n, 3n, 2n, 1n], 'active staged operations should enumerate newest queued operations first')
		assert.strictEqual(activeOperations[0]?.amount, fifthAllowance, 'newest overflow operation should retain its amount')
		assert.strictEqual(activeOperations[1]?.amount, fourthAllowance, 'newest pending operation should retain its amount')
		assert.strictEqual(activeOperations[2]?.amount, thirdAllowance, 'middle pending operation should retain its amount')
		assert.strictEqual(activeOperations[3]?.amount, secondAllowance, 'older pending operation should retain its amount')
		assert.strictEqual(activeOperations[4]?.amount, firstAllowance, 'oldest pending operation should retain its amount')

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		const pendingOperationSlotIdAfterSettlement = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'pendingOperationSlotId',
			args: [],
		})
		const pendingSettlementOperationCountAfterSettlement = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'getPendingSettlementOperationCount',
			args: [],
		})
		const updatedActiveStagedOperationCount = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'getActiveStagedOperationCount',
			args: [],
		})
		const [remainingOperationIds, remainingOperations] = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'getActiveStagedOperations',
			args: [0n, 5n],
		})

		const stagedOperation1 = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'stagedOperations',
			args: [1n],
		})
		const stagedOperation2 = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'stagedOperations',
			args: [2n],
		})
		const stagedOperation3 = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'stagedOperations',
			args: [3n],
		})
		const stagedOperation4 = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'stagedOperations',
			args: [4n],
		})
		const stagedOperation5 = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'stagedOperations',
			args: [5n],
		})
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

		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'executeStagedOperation',
					args: [5n],
				}),
		)
		const finalActiveStagedOperationCount = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'getActiveStagedOperationCount',
			args: [],
		})
		const finalVault = await getSecurityVault(client, securityPool, client.account.address)
		assert.strictEqual(finalActiveStagedOperationCount, 0n, 'manual overflow execution should consume the final active operation')
		assert.strictEqual(finalVault.securityBondAllowance, fifthAllowance, 'manual overflow execution should apply the final allowance update')
	})

	test('staged operations can only be executed once', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const successfulAllowance = repDeposit / 4n
		const manualOperationId = 5n

		await fillPendingSettlementOperationList(ethCost, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS)
		await queueStagedOperation(OperationType.SetSecurityBondsAllowance, client.account.address, successfulAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'executeStagedOperation',
					args: [manualOperationId],
				}),
		)

		await assert.rejects(
			async () =>
				await writeContractAndWait(
					client,
					async () =>
						await client.writeContract({
							abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
							address: priceOracle,
							functionName: 'executeStagedOperation',
							args: [manualOperationId],
						}),
				),
			/no such operation/i,
		)
	})

	test('non-liquidation staged operations require the initiator vault as target', async () => {
		const otherVault = addressString(TEST_ADDRESSES[1])
		const nonLiquidationOperations = [OperationType.WithdrawRep, OperationType.SetSecurityBondsAllowance]

		for (const operation of nonLiquidationOperations) {
			await assert.rejects(
				async () =>
					await writeContractAndWait(
						client,
						async () =>
							await client.writeContract({
								abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
								address: priceOracle,
								functionName: 'requestPriceIfNeededAndStageOperation',
								args: [operation, otherVault, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS],
							}),
					),
				/self operation target must match initiator/i,
			)
		}
	})

	test('staged liquidations expire after their caller-selected validity window', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const liquidationTimeoutSeconds = 60n
		const manualOperationId = 5n
		const targetVault = addressString(TEST_ADDRESSES[1])

		await fillPendingSettlementOperationList(ethCost, liquidationTimeoutSeconds)
		await queueStagedOperation(OperationType.Liquidation, targetVault, 1n, liquidationTimeoutSeconds)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await mockWindow.advanceTime(liquidationTimeoutSeconds + 1n)
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'requestPrice',
					value: ethCost,
				}),
		)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)

		const expiredExecutionHash = await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'executeStagedOperation',
					args: [manualOperationId],
				}),
		)
		const expiredOperation = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'stagedOperations',
			args: [manualOperationId],
		})
		const expiredExecutionReceipt = await client.waitForTransactionReceipt({ hash: expiredExecutionHash })
		const executionLog = findExecutedStagedOperationLog(expiredExecutionReceipt.logs)
		if (executionLog === undefined) throw new Error('missing expired liquidation execution event')
		assert.strictEqual(expiredOperation[1], zeroAddress, 'expired liquidation should be consumed after execution attempt')
		assert.strictEqual(executionLog.args.operationId, manualOperationId)
		assert.strictEqual(executionLog.args.operation, OperationType.Liquidation)
		assert.strictEqual(executionLog.args.success, false)
		assert.strictEqual(executionLog.args.errorMessage, 'staged operation expired')
	})

	test('staged self operations expire after their caller-selected validity window', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const selfOperationTimeoutSeconds = 60n
		const manualOperationId = 5n

		await fillPendingSettlementOperationList(ethCost, selfOperationTimeoutSeconds)
		await queueStagedOperation(OperationType.SetSecurityBondsAllowance, client.account.address, 1n, selfOperationTimeoutSeconds)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await mockWindow.advanceTime(selfOperationTimeoutSeconds + 1n)
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'requestPrice',
					value: ethCost,
				}),
		)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)

		const expiredExecutionHash = await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
					address: priceOracle,
					functionName: 'executeStagedOperation',
					args: [manualOperationId],
				}),
		)
		const expiredOperation = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: priceOracle,
			functionName: 'stagedOperations',
			args: [manualOperationId],
		})
		const expiredExecutionReceipt = await client.waitForTransactionReceipt({ hash: expiredExecutionHash })
		const executionLog = findExecutedStagedOperationLog(expiredExecutionReceipt.logs)
		if (executionLog === undefined) throw new Error('missing expired self-operation execution event')
		assert.strictEqual(expiredOperation[1], zeroAddress, 'expired self operation should be consumed after execution attempt')
		assert.strictEqual(executionLog.args.operationId, manualOperationId)
		assert.strictEqual(executionLog.args.operation, OperationType.SetSecurityBondsAllowance)
		assert.strictEqual(executionLog.args.success, false)
		assert.strictEqual(executionLog.args.errorMessage, 'staged operation expired')
	})
})
