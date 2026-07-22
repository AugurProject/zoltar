import { zeroAddress } from '@zoltar/shared/ethereum'
import type { Address } from '@zoltar/shared/ethereum'
import { AnvilWindowEthereum } from '../../AnvilWindowEthereum'
import { addressString } from '../bigint'
import { getSecurityPoolAddresses } from './deployPeripherals'
import { GENESIS_REPUTATION_TOKEN } from '../constants'
import { approveToken, contractExists, getERC20Balance } from '../utilities'
import { WriteClient } from '../clients'
import assert from '../assert'
import {
	executeStagedOperation,
	getIsPriceValid,
	getLastPrice,
	getOpenOracleReportMeta,
	getOpenOracleReportStatus,
	getPendingOperationSlotId,
	getPendingReportId,
	getRequestPriceEthCost,
	OperationType,
	requestPriceIfNeededAndStageOperationWithInitialReportPrice,
	requestPriceWithValue,
	settleAndFinalizeCoordinatorPrice,
} from './peripherals'
import { QuestionOutcome } from '../../types/types'
import { forkZoltarWithOwnEscalationGame } from './securityPoolForker'
import { getTotalTheoreticalSupply } from './zoltar'
import { depositRep, depositToEscalationGame, getRepToken, getSecurityVault, poolOwnershipToRep } from './securityPool'

const genesisUniverse = 0n
const securityMultiplier = 2n
const PRICE_PRECISION = 10n ** 18n
const DEFAULT_SELF_OPERATION_VALID_FOR_SECONDS = 5n * 60n
const ORACLE_PRICE_VALID_FOR_SECONDS = 5n * 60n

export const approveAndDepositRep = async (client: WriteClient, repDeposit: bigint, questionId: bigint) => {
	const securityPoolAddress = getSecurityPoolAddresses(zeroAddress, genesisUniverse, questionId, securityMultiplier).securityPool
	assert.ok(await contractExists(client, securityPoolAddress), 'security pool not deployed')

	const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	await depositRep(client, securityPoolAddress, repDeposit)

	const newBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	assert.strictEqual(newBalance, startBalance + repDeposit, 'Did not deposit rep')
}

export const triggerOwnGameFork = async (client: WriteClient, securityPoolAddress: Address) => {
	const repToken = await getRepToken(client, securityPoolAddress)
	const forkThreshold = (await getTotalTheoreticalSupply(client, repToken)) / 20n / securityMultiplier
	const vault = await getSecurityVault(client, securityPoolAddress, client.account.address)
	const repAmount = await poolOwnershipToRep(client, securityPoolAddress, vault.repDepositShare)
	assert.ok(repAmount >= 2n * forkThreshold, 'not enough rep in vault to fork')
	const minRepDeposit = 10n * 10n ** 18n
	const secondEscalationDeposit = repAmount - 2n * forkThreshold < minRepDeposit ? repAmount - forkThreshold : forkThreshold
	await depositToEscalationGame(client, securityPoolAddress, QuestionOutcome.Yes, forkThreshold)
	await depositToEscalationGame(client, securityPoolAddress, QuestionOutcome.No, secondEscalationDeposit)
	await forkZoltarWithOwnEscalationGame(client, securityPoolAddress)
}

export const handleOracleReporting = async (client: WriteClient, mockWindow: AnvilWindowEthereum, priceOracleManagerAndOperatorQueuer: Address, forceRepEthPriceTo: bigint) => {
	const pendingReportId = await getPendingReportId(client, priceOracleManagerAndOperatorQueuer)
	if (pendingReportId === 0n) {
		// operation already executed
		return
	}
	assert.ok(pendingReportId > 0, 'Operation is not queued')

	const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
	const reportStatus = await getOpenOracleReportStatus(client, pendingReportId)
	const expectedAmount1 = reportMeta.exactToken1Report
	const expectedAmount2 = (expectedAmount1 * forceRepEthPriceTo + PRICE_PRECISION - 1n) / PRICE_PRECISION
	const expectedSettledPrice = (expectedAmount2 * PRICE_PRECISION) / expectedAmount1

	assert.strictEqual(reportStatus.currentAmount1, expectedAmount1, 'pending report should preserve the coordinator-selected token1 amount')
	assert.strictEqual(reportStatus.currentAmount2, expectedAmount2, 'pending report should already encode the forced price before settlement')
	assert.notStrictEqual(reportStatus.currentReporter, zeroAddress, 'pending report should already have an initial reporter')
	assert.strictEqual(reportStatus.currentReporter, priceOracleManagerAndOperatorQueuer, 'pending report should use the coordinator as the current reporter')
	assert.strictEqual(reportStatus.initialReporter, priceOracleManagerAndOperatorQueuer, 'pending report should preserve the coordinator as the initial reporter')
	assert.ok(reportStatus.reportTimestamp > 0n, 'pending report should already have a report timestamp')

	await settleAndFinalizeCoordinatorPrice(client, mockWindow, priceOracleManagerAndOperatorQueuer, pendingReportId)
	assert.strictEqual(await getLastPrice(client, priceOracleManagerAndOperatorQueuer), expectedSettledPrice, 'settled coordinator price should match the encoded pending report price')
	const operationId = await getPendingOperationSlotId(client, priceOracleManagerAndOperatorQueuer)
	if (operationId !== 0n) await executeStagedOperation(client, priceOracleManagerAndOperatorQueuer, operationId)
}

export const manipulatePriceOracleAndPerformOperation = async (client: WriteClient, mockWindow: AnvilWindowEthereum, priceOracleManagerAndOperatorQueuer: Address, operation: OperationType, targetVault: Address, amount: bigint, forceRepEthPriceTo: bigint = PRICE_PRECISION) => {
	const ethCost = await getRequestPriceEthCost(client, priceOracleManagerAndOperatorQueuer)
	await requestPriceIfNeededAndStageOperationWithInitialReportPrice(client, priceOracleManagerAndOperatorQueuer, operation, targetVault, amount, DEFAULT_SELF_OPERATION_VALID_FOR_SECONDS, forceRepEthPriceTo, ethCost)
	await handleOracleReporting(client, mockWindow, priceOracleManagerAndOperatorQueuer, forceRepEthPriceTo)
}

export const manipulatePriceOracle = async (client: WriteClient, mockWindow: AnvilWindowEthereum, priceOracleManagerAndOperatorQueuer: Address, forceRepEthPriceTo: bigint = PRICE_PRECISION) => {
	if (await getIsPriceValid(client, priceOracleManagerAndOperatorQueuer)) {
		await mockWindow.advanceTime(ORACLE_PRICE_VALID_FOR_SECONDS + 1n)
	}
	const ethCost = await getRequestPriceEthCost(client, priceOracleManagerAndOperatorQueuer)
	await requestPriceWithValue(client, priceOracleManagerAndOperatorQueuer, ethCost, forceRepEthPriceTo)
	await handleOracleReporting(client, mockWindow, priceOracleManagerAndOperatorQueuer, forceRepEthPriceTo)
}

export const canLiquidate = (lastPrice: bigint, securityBondAllowance: bigint, repClaim: bigint, securityMultiplier: bigint) => securityBondAllowance * lastPrice * securityMultiplier > repClaim * PRICE_PRECISION
