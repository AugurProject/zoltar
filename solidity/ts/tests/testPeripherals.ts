import { describe, beforeEach, test } from 'node:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, WETH_ADDRESS } from '../testsuite/simulator/utils/constants.js'
import { approveToken, createQuestion, ensureZoltarDeployed, getERC20Balance, getQuestionData, getZoltarAddress, isZoltarDeployed, setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { addressString } from '../testsuite/simulator/utils/bigint.js'
import { deploySecurityPool, depositRep, ensureOpenOracleDeployed, ensureSecurityPoolFactoryDeployed, getDeployedSecurityPool, getOpenOracleAddress, getOpenOracleExtraData, getOpenOracleReportMeta, getPendingReportId, getPriceOracleManagerAndOperatorQueuer, isOpenOracleDeployed, isSecurityPoolFactoryDeployed, openOracleSettle, openOracleSubmitInitialReport, OperationType, requestPriceIfNeededAndQueueOperation, wrapWeth } from '../testsuite/simulator/utils/peripherals.js'
import assert from 'node:assert'

const genesisUniverse = 0n
const marketId = 1n
const securityMultiplier = 2n;
const startingPerSecondFee = 1n;
const startingRepEthPrice = 1n;
const ethAmountForCompleteSets = 0n;

const deployZoltarAndCreateMarket = async (client: WriteClient, curentTimestamp: bigint) => {
	await ensureZoltarDeployed(client)
	const zoltar = getZoltarAddress()
	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
	const endTime = curentTimestamp + DAY
	await createQuestion(client, genesisUniverse, endTime, 'test')
	return await getQuestionData(client, marketId)
}

const deployPeripheralsAndGetDeployedSecurityPool = async (client: WriteClient) => {
	// deploy open Oracle
	await ensureOpenOracleDeployed(client);
	assert.ok(await isOpenOracleDeployed(client), 'Open Oracle Not Deployed!')
	const openOracle = getOpenOracleAddress()
	await ensureSecurityPoolFactoryDeployed(client);
	assert.ok(await isSecurityPoolFactoryDeployed(client), 'Security Pool Factory Not Deployed!')
	await deploySecurityPool(client, openOracle, genesisUniverse, marketId, securityMultiplier, startingPerSecondFee, startingRepEthPrice, ethAmountForCompleteSets)
	return await getDeployedSecurityPool(client, 1n)
}

describe('Peripherals Contract Test Suite', () => {

	let mockWindow: MockWindowEthereum
	let curentTimestamp: bigint

	beforeEach(async () => {
		mockWindow = getMockedEthSimulateWindowEthereum()
		//await mockWindow.setStartBLock(mockWindow.getTime)
		await setupTestAccounts(mockWindow)
		curentTimestamp = BigInt(Math.floor((await mockWindow.getTime()).getTime() / 1000))
	})

	test('canDoHappyPath', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await deployZoltarAndCreateMarket(client, curentTimestamp)
		const isDeployed = await isZoltarDeployed(client)
		assert.ok(isDeployed, `Zoltar Not Deployed!`)

		const securityPoolAddress = await deployPeripheralsAndGetDeployedSecurityPool(client)
		assert.ok(BigInt(securityPoolAddress) !== 0n, `Security Pool Not Deployed!`)
		assert.ok(await isOpenOracleDeployed(client), 'Open Oracle is not deployed')
		const repDeposit = 10n * 10n ** 18n
		const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
		await depositRep(client, securityPoolAddress, repDeposit);

		const newBalace = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		assert.strictEqual(startBalance, newBalace + repDeposit, 'Did not deposit rep')

		const priceOracleManagerAndOperatorQueuer = await getPriceOracleManagerAndOperatorQueuer(client, securityPoolAddress)
		await requestPriceIfNeededAndQueueOperation(client, priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit)

		const pendingReportId = await getPendingReportId(client, priceOracleManagerAndOperatorQueuer)
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

		// settle and execute the operation (withdraw rep)
		await openOracleSettle(client, pendingReportId)
		assert.strictEqual(startBalance, startBalance, 'Did not get rep back')
	})


	test('canDepositAndWithdrawRep' , async () => {
		//depositRep
		//requestPriceIfNeededAndQueueOperation(OperationType operation, address targetVault, uint256 amount)
		//performWithdrawRep
	})
})
