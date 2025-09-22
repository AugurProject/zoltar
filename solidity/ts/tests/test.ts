import { describe, beforeEach, test } from 'node:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient } from '../testsuite/simulator/utils/viem.js'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { approveToken, createMarket, ensureZoltarDeployed, getERC20Balance, getMarketData, getZoltarAddress, getUniverseData, initialTokenBalance, isZoltarDeployed, setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import assert from 'node:assert'
import { addressString } from '../testsuite/simulator/utils/bigint.js'

describe('Contract Test Suite', () => {

	let mockWindow: MockWindowEthereum
	let curentTimestamp: bigint

	beforeEach(async () => {
		mockWindow = getMockedEthSimulateWindowEthereum()
		await setupTestAccounts(mockWindow)
		curentTimestamp = BigInt(Math.floor((await mockWindow.getTime()).getTime() / 1000))
	})

	test('canDeployContract', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await ensureZoltarDeployed(client)
		const isDeployed = await isZoltarDeployed(client)
		assert.ok(isDeployed, `Not Deployed!`)

		const genesisUniverseData = await getUniverseData(client, 0n)
		assert.strictEqual(genesisUniverseData[0].toLowerCase(), addressString(GENESIS_REPUTATION_TOKEN), 'Genesis universe not recognized or not initialized properly')
	})

	test('canCreateMarket', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await ensureZoltarDeployed(client)
		const zoltar = getZoltarAddress()
		const genesisUniverse = 0n

		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const repBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		assert.strictEqual(repBalance, initialTokenBalance, "REP not initially minted")

		const endTime = curentTimestamp + DAY
		await createMarket(client, genesisUniverse, endTime, "test")

		const marketId = 1n
		const marketData = await getMarketData(client, marketId)

		assert.strictEqual(marketData[0], endTime, 'Market endTime not as expected')
		assert.strictEqual(marketData[1], genesisUniverse, 'Market origin universe not as expected')
		assert.strictEqual(marketData[2].toLowerCase(), client.account.address, 'Market designated reporter not as expected')
		assert.strictEqual(marketData[3], "test", 'Market extraInfo not as expected')
	})
})
