import { zeroAddress } from 'viem'
import { MockWindowEthereum } from '../../MockWindowEthereum.js'
import { addressString } from '../bigint.js'
import { DAY, GENESIS_REPUTATION_TOKEN, WETH_ADDRESS } from '../constants.js'
import { getInfraContractAddresses, getSecurityPoolAddresses } from './deployPeripherals.js'
import { approveToken, contractExists, getERC20Balance } from '../utilities.js'
import { WriteClient } from '../viem.js'
import assert from 'node:assert'
import { getOpenOracleExtraData, getOpenOracleReportMeta, getPendingReportId, openOracleSettle, openOracleSubmitInitialReport, OperationType, requestPrice, requestPriceIfNeededAndQueueOperation, wrapWeth } from './peripherals.js'
import { QuestionOutcome } from '../../types/types.js'
import { forkZoltarWithOwnEscalationGame } from './securityPoolForker.js'
import { getTotalTheoreticalSupply } from './zoltar.js'
import { depositRep, depositToEscalationGame, getRepToken, getSecurityVault, poolOwnershipToRep } from './securityPool.js'

export const genesisUniverse = 0n
export const securityMultiplier = 2n
export const startingRepEthPrice = 1n
export const completeSetCollateralAmount = 0n
export const PRICE_PRECISION = 10n ** 18n
export const MAX_RETENTION_RATE = 999_999_996_848_000_000n // ≈90% yearly
export const EXTRA_INFO = 'test market!'

export const approveAndDepositRep = async (client: WriteClient, repDeposit: bigint, marketId: bigint) => {
	const securityPoolAddress = getSecurityPoolAddresses(zeroAddress, genesisUniverse, marketId, securityMultiplier).securityPool
	assert.ok(await contractExists(client, securityPoolAddress), 'security pool not deployed')

	const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	await depositRep(client, securityPoolAddress, repDeposit)

	const newBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	assert.strictEqual(newBalance, startBalance + repDeposit, 'Did not deposit rep')
}

export const triggerOwnGameFork = async (client: WriteClient, securityPoolAddress: `0x${ string }`) => {
	const repToken = await getRepToken(client, securityPoolAddress)
	const forkThreshold = (await getTotalTheoreticalSupply(client, repToken)) / 20n /2n
	const vault = await getSecurityVault(client, securityPoolAddress, client.account.address)
	const repAmount = await poolOwnershipToRep(client, securityPoolAddress, vault.repDepositShare)
	assert.ok(repAmount >= 2n * forkThreshold, 'not enough rep in vault to fork')
	await depositToEscalationGame(client, securityPoolAddress, QuestionOutcome.Yes, forkThreshold)
	await depositToEscalationGame(client, securityPoolAddress, QuestionOutcome.No, forkThreshold)
	await forkZoltarWithOwnEscalationGame(client, securityPoolAddress)
}

export const handleOracleReporting = async (client: WriteClient, mockWindow: MockWindowEthereum, priceOracleManagerAndOperatorQueuer: `0x${ string }`, forceRepEthPriceTo: bigint) => {
	const pendingReportId = await getPendingReportId(client, priceOracleManagerAndOperatorQueuer)
	if (pendingReportId === 0n) {
		// operation already executed
		return
	}
	assert.ok(pendingReportId > 0, 'Operation is not queued')

	const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)

	// initial report
	const amount1 = reportMeta.exactToken1Report
	const amount2 = amount1 * PRICE_PRECISION / forceRepEthPriceTo

	const openOracle = getInfraContractAddresses().openOracle
	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
	await approveToken(client, WETH_ADDRESS, openOracle)
	await wrapWeth(client, amount2)
	const wethBalance = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
	assert.strictEqual(wethBalance, amount2, 'Did not wrap weth')

	const stateHash = (await getOpenOracleExtraData(client, pendingReportId)).stateHash
	await openOracleSubmitInitialReport(client, pendingReportId, amount1, amount2, stateHash)

	await mockWindow.advanceTime(DAY)

	await openOracleSettle(client, pendingReportId)
}

export const manipulatePriceOracleAndPerformOperation = async (client: WriteClient, mockWindow: MockWindowEthereum, priceOracleManagerAndOperatorQueuer: `0x${ string }`, operation: OperationType, targetVault: `0x${ string }`, amount: bigint, forceRepEthPriceTo: bigint = PRICE_PRECISION) => {
	await requestPriceIfNeededAndQueueOperation(client, priceOracleManagerAndOperatorQueuer, operation, targetVault, amount)
	await handleOracleReporting(client, mockWindow, priceOracleManagerAndOperatorQueuer, forceRepEthPriceTo)
}

export const manipulatePriceOracle = async (client: WriteClient, mockWindow: MockWindowEthereum, priceOracleManagerAndOperatorQueuer: `0x${ string }`, forceRepEthPriceTo: bigint = PRICE_PRECISION) => {
	await requestPrice(client, priceOracleManagerAndOperatorQueuer)
	await handleOracleReporting(client, mockWindow, priceOracleManagerAndOperatorQueuer, forceRepEthPriceTo)
}

export const canLiquidate = (lastPrice: bigint, securityBondAllowance: bigint, stakedRep: bigint, securityMultiplier: bigint) => securityBondAllowance * lastPrice * securityMultiplier > stakedRep * PRICE_PRECISION

