import { zeroAddress } from 'viem'
import { MockWindowEthereum } from '../MockWindowEthereum.js'
import { QuestionOutcome } from '../types/types.js'
import { addressString } from './bigint.js'
import { DAY, GENESIS_REPUTATION_TOKEN, WETH_ADDRESS } from './constants.js'
import { deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from './deployPeripherals.js'
import { approveToken, contractExists, createQuestion, dispute, ensureZoltarDeployed, getERC20Balance, getQuestionData, getUniverseData, getZoltarAddress, isZoltarDeployed, reportOutcome } from './utilities.js'
import { WriteClient } from './viem.js'
import assert from 'node:assert'
import { depositRep, getOpenOracleExtraData, getOpenOracleReportMeta, getPendingReportId, openOracleSettle, openOracleSubmitInitialReport, OperationType, requestPrice, requestPriceIfNeededAndQueueOperation, wrapWeth } from './peripherals.js'

export const genesisUniverse = 0n
export const questionId = 1n
export const securityMultiplier = 2n
export const startingRepEthPrice = 1n
export const completeSetCollateralAmount = 0n
export const PRICE_PRECISION = 10n ** 18n
export const MAX_RETENTION_RATE = 999_999_996_848_000_000n // ≈90% yearly

export const deployZoltarAndCreateMarket = async (client: WriteClient, questionEndTime: bigint) => {
	await ensureZoltarDeployed(client)
	const isDeployed = await isZoltarDeployed(client)
	assert.ok(isDeployed, `Zoltar Not Deployed!`)
	const zoltar = getZoltarAddress()
	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
	await createQuestion(client, genesisUniverse, questionEndTime, 'test')
	return await getQuestionData(client, questionId)
}

export const deployPeripherals = async (client: WriteClient) => {
	await ensureInfraDeployed(client)
	await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier, MAX_RETENTION_RATE, startingRepEthPrice, completeSetCollateralAmount)
	const securityPoolAddress = getSecurityPoolAddresses(zeroAddress, genesisUniverse, questionId, securityMultiplier).securityPool
	assert.ok(await contractExists(client, securityPoolAddress), 'security pool not deployed')
}

export const approveAndDepositRep = async (client: WriteClient, repDeposit: bigint) => {
	const securityPoolAddress = getSecurityPoolAddresses(zeroAddress, genesisUniverse, questionId, securityMultiplier).securityPool
	assert.ok(await contractExists(client, securityPoolAddress), 'security pool not deployed')

	const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	await depositRep(client, securityPoolAddress, repDeposit)

	const newBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	assert.strictEqual(newBalance, startBalance + repDeposit, 'Did not deposit rep')
}

export const triggerFork = async(client: WriteClient, mockWindow: MockWindowEthereum, questionId: bigint) => {
	await ensureZoltarDeployed(client)
	await mockWindow.advanceTime(DAY)
	const initialOutcome = QuestionOutcome.Yes
	await reportOutcome(client, genesisUniverse, questionId, initialOutcome)
	const disputeOutcome = QuestionOutcome.No
	await dispute(client, genesisUniverse, questionId, disputeOutcome)
	const invalidUniverseId = 1n
	const yesUniverseId = 2n
	const noUniverseId = 3n
	return {
		invalidUniverseData: await getUniverseData(client, invalidUniverseId),
		yesUniverseData: await getUniverseData(client, yesUniverseId),
		noUniverseData: await getUniverseData(client, noUniverseId)
	}
}

export const handleOracleReporting = async(client: WriteClient, mockWindow: MockWindowEthereum, priceOracleManagerAndOperatorQueuer: `0x${ string }`, forceRepEthPriceTo: bigint) => {
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

export const manipulatePriceOracleAndPerformOperation = async(client: WriteClient, mockWindow: MockWindowEthereum, priceOracleManagerAndOperatorQueuer: `0x${ string }`, operation: OperationType, targetVault: `0x${ string }`, amount: bigint, forceRepEthPriceTo: bigint = PRICE_PRECISION) => {
	await requestPriceIfNeededAndQueueOperation(client, priceOracleManagerAndOperatorQueuer, operation, targetVault, amount)
	await handleOracleReporting(client, mockWindow, priceOracleManagerAndOperatorQueuer, forceRepEthPriceTo)
}

export const manipulatePriceOracle = async(client: WriteClient, mockWindow: MockWindowEthereum, priceOracleManagerAndOperatorQueuer: `0x${ string }`, forceRepEthPriceTo: bigint = PRICE_PRECISION) => {
	await requestPrice(client, priceOracleManagerAndOperatorQueuer)
	await handleOracleReporting(client, mockWindow, priceOracleManagerAndOperatorQueuer, forceRepEthPriceTo)
}

export const canLiquidate = (lastPrice: bigint, securityBondAllowance: bigint, stakedRep: bigint, securityMultiplier: bigint) => securityBondAllowance * lastPrice * securityMultiplier > stakedRep * PRICE_PRECISION

