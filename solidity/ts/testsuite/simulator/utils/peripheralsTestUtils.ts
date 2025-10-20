import { MockWindowEthereum } from '../MockWindowEthereum.js'
import { QuestionOutcome } from '../types/types.js'
import { addressString } from './bigint.js'
import { DAY, GENESIS_REPUTATION_TOKEN, WETH_ADDRESS } from './constants.js'
import { deploySecurityPool, depositRep, ensureOpenOracleDeployed, ensureSecurityPoolFactoryDeployed, getOpenOracleAddress, getOpenOracleExtraData, getOpenOracleReportMeta, getPendingReportId, getSecurityPoolAddress, isOpenOracleDeployed, isSecurityPoolFactoryDeployed, openOracleSettle, openOracleSubmitInitialReport, OperationType, requestPriceIfNeededAndQueueOperation, wrapWeth } from './peripherals.js'
import { approveToken, createQuestion, dispute, ensureZoltarDeployed, getERC20Balance, getQuestionData, getUniverseData, getZoltarAddress, isZoltarDeployed, reportOutcome } from './utilities.js'
import { WriteClient } from './viem.js'
import assert from 'node:assert'

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
	await ensureOpenOracleDeployed(client)
	assert.ok(await isOpenOracleDeployed(client), 'Open Oracle Not Deployed!')
	const openOracle = getOpenOracleAddress()
	await ensureSecurityPoolFactoryDeployed(client)
	assert.ok(await isSecurityPoolFactoryDeployed(client), 'Security Pool Factory Not Deployed!')
	await deploySecurityPool(client, openOracle, genesisUniverse, questionId, securityMultiplier, MAX_RETENTION_RATE, startingRepEthPrice, completeSetCollateralAmount)
}

export const approveAndDepositRep = async (client: WriteClient, repDeposit: bigint) => {
	const securityPoolAddress = getSecurityPoolAddress(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)

	const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	await depositRep(client, securityPoolAddress, repDeposit)

	const newBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
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

export const requestPrice = async(client: WriteClient, mockWindow: MockWindowEthereum, priceOracleManagerAndOperatorQueuer: `0x${ string }`, operation: OperationType, targetVault: `0x${ string }`, amount: bigint) => {
	await requestPriceIfNeededAndQueueOperation(client, priceOracleManagerAndOperatorQueuer, operation, targetVault, amount)

	const pendingReportId = await getPendingReportId(client, priceOracleManagerAndOperatorQueuer)
	if (pendingReportId === 0n) {
		// operation already executed
		return
	}
	assert.ok(pendingReportId > 0, 'Operation is not queued')

	const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)

	// initial report
	const amount1 = reportMeta.exactToken1Report
	const amount2 = amount1

	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getOpenOracleAddress())
	await approveToken(client, WETH_ADDRESS, getOpenOracleAddress())
	await wrapWeth(client, amount2)
	const wethBalance = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
	assert.strictEqual(wethBalance, amount2, 'Did not wrap weth')

	const stateHash = (await getOpenOracleExtraData(client, pendingReportId)).stateHash
	await openOracleSubmitInitialReport(client, pendingReportId, amount1, amount2, stateHash)

	await mockWindow.advanceTime(DAY)

	await openOracleSettle(client, pendingReportId)
}

