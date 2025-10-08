import { describe, beforeEach, test } from 'node:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { approveToken, createQuestion, ensureZoltarDeployed, getQuestionData, getZoltarAddress, isZoltarDeployed, setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { addressString } from '../testsuite/simulator/utils/bigint.js'
import { deploySecurityPool, ensureOpenOracleDeployed, ensureSecurityPoolFactoryDeployed, getDeployedSecurityPool, getOpenOracleAddress, isOpenOracleDeployed, isSecurityPoolFactoryDeployed } from '../testsuite/simulator/utils/peripherals.js'
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
	await createQuestion(client, genesisUniverse, endTime, "test")
	const marketData = await getQuestionData(client, marketId)
}

const deployPeripheralsAndGetDeployedSecurityPool = async (client: WriteClient) => {
	// deploy open Oracle
	await ensureOpenOracleDeployed(client);
	assert.ok(await isOpenOracleDeployed(client), `Open Oracle Not Deployed!`)
	const openOracle = getOpenOracleAddress()
	await ensureSecurityPoolFactoryDeployed(client);
	assert.ok(await isSecurityPoolFactoryDeployed(client), `Security Pool Factory Not Deployed!`)
	await deploySecurityPool(client, openOracle, genesisUniverse, marketId, securityMultiplier, startingPerSecondFee, startingRepEthPrice, ethAmountForCompleteSets)
	return await getDeployedSecurityPool(client, 1n)
}

describe('Peripherals Contract Test Suite', () => {

	let mockWindow: MockWindowEthereum
	let curentTimestamp: bigint

	beforeEach(async () => {
		mockWindow = getMockedEthSimulateWindowEthereum()
		await setupTestAccounts(mockWindow)
		curentTimestamp = BigInt(Math.floor((await mockWindow.getTime()).getTime() / 1000))
	})

	test('canInitEverything', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await deployZoltarAndCreateMarket(client, curentTimestamp)
		const isDeployed = await isZoltarDeployed(client)
		assert.ok(isDeployed, `Zoltar Not Deployed!`)

		const securityPoolAddress = await deployPeripheralsAndGetDeployedSecurityPool(client)
		assert.ok(securityPoolAddress !== 0n, `Security Pool Not Deployed!`)
	})

	test('canDepositRep', async () => {
		//depositRep
	})

	test('anDepositAndWithdrawRep') , async () => {
		//depositRep
		//requestPriceIfNeededAndQueueOperation(OperationType operation, address targetVault, uint256 amount)
		//performWithdrawRep
	})
})
