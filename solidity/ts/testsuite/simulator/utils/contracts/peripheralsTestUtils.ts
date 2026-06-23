import { zeroAddress } from 'viem'
import type { Address } from 'viem'
import { AnvilWindowEthereum } from '../../AnvilWindowEthereum'
import { addressString } from '../bigint'
import { GENESIS_REPUTATION_TOKEN, WETH_ADDRESS } from '../constants'
import { getInfraContractAddresses, getSecurityPoolAddresses } from './deployPeripherals'
import { approveToken, contractExists, getERC20Balance, getETHBalance } from '../utilities'
import { WriteClient } from '../viem'
import assert from '../assert'
import { getOpenOracleExtraData, getOpenOracleReportMeta, getPendingReportId, openOracleSettle, openOracleSubmitInitialReport, OperationType, requestPrice, requestPriceIfNeededAndStageOperation, wrapWeth } from './peripherals'
import { QuestionOutcome } from '../../types/types'
import { forkZoltarWithOwnEscalationGame } from './securityPoolForker'
import { getTotalTheoreticalSupply } from './zoltar'
import { depositRep, depositToEscalationGame, getRepToken, getSecurityVault, poolOwnershipToRep } from './securityPool'

const genesisUniverse = 0n
const securityMultiplier = 2n
const PRICE_PRECISION = 10n ** 18n

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

	// initial report
	const amount1 = reportMeta.exactToken1Report
	const amount2 = (amount1 * PRICE_PRECISION) / forceRepEthPriceTo

	const openOracle = getInfraContractAddresses().openOracle
	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
	await approveToken(client, WETH_ADDRESS, openOracle)
	const ethBalance = await getETHBalance(client, client.account.address)
	if (ethBalance <= amount2) await mockWindow.setBalance(client.account.address, amount2 + 10n ** 18n)
	const wethBalanceBefore = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
	await wrapWeth(client, amount2)
	const wethBalance = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
	assert.strictEqual(wethBalance - wethBalanceBefore, amount2, 'Did not wrap correct amount of weth')

	const stateHash = (await getOpenOracleExtraData(client, pendingReportId)).stateHash
	await openOracleSubmitInitialReport(client, pendingReportId, amount1, amount2, stateHash)

	await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)

	await openOracleSettle(client, pendingReportId)
}

export const manipulatePriceOracleAndPerformOperation = async (client: WriteClient, mockWindow: AnvilWindowEthereum, priceOracleManagerAndOperatorQueuer: Address, operation: OperationType, targetVault: Address, amount: bigint, forceRepEthPriceTo: bigint = PRICE_PRECISION) => {
	await requestPriceIfNeededAndStageOperation(client, priceOracleManagerAndOperatorQueuer, operation, targetVault, amount)
	await handleOracleReporting(client, mockWindow, priceOracleManagerAndOperatorQueuer, forceRepEthPriceTo)
}

export const manipulatePriceOracle = async (client: WriteClient, mockWindow: AnvilWindowEthereum, priceOracleManagerAndOperatorQueuer: Address, forceRepEthPriceTo: bigint = PRICE_PRECISION) => {
	await requestPrice(client, priceOracleManagerAndOperatorQueuer)
	await handleOracleReporting(client, mockWindow, priceOracleManagerAndOperatorQueuer, forceRepEthPriceTo)
}

export const canLiquidate = (lastPrice: bigint, securityBondAllowance: bigint, repClaim: bigint, securityMultiplier: bigint) => securityBondAllowance * lastPrice * securityMultiplier > repClaim * PRICE_PRECISION
