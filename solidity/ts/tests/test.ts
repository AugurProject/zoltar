import { describe, beforeEach, test } from 'node:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient } from '../testsuite/simulator/utils/viem.js'
import { BURN_ADDRESS, DAY, GENESIS_REPUTATION_TOKEN, REP_BOND, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { approveToken, createMarket, ensureZoltarDeployed, getERC20Balance, getMarketData, getZoltarAddress, getUniverseData, initialTokenBalance, isZoltarDeployed, setupTestAccounts, reportOutcome, isFinalized, finalizeMarket, getWinningOutcome, dispute, splitRep, splitStakedRep } from '../testsuite/simulator/utils/utilities.js'
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

	test('canResolveMarket', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await ensureZoltarDeployed(client)
		const zoltar = getZoltarAddress()
		const genesisUniverse = 0n

		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const endTime = curentTimestamp + DAY
		await createMarket(client, genesisUniverse, endTime, "test")

		const marketId = 1n
		const winningOutcome = 1n

		// We can't report until the market has reached its end time
		await assert.rejects(reportOutcome(client, genesisUniverse, marketId, winningOutcome))

		await mockWindow.advanceTime(DAY)

		await reportOutcome(client, genesisUniverse, marketId, winningOutcome)

		const isFInalized = await isFinalized(client, genesisUniverse, marketId)
		assert.ok(!isFInalized, "Market incorrectly recognized as finalized")
		await assert.rejects(finalizeMarket(client, genesisUniverse, marketId))

		await mockWindow.advanceTime(DAY + 1n)

		const isFInalizedNow = await isFinalized(client, genesisUniverse, marketId)
		assert.ok(isFInalizedNow, "Market not recognized as finalized")

		const repBalanceBeforeReturn = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await finalizeMarket(client, genesisUniverse, marketId)
		const repBalanceAfterReturn = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		assert.strictEqual(repBalanceAfterReturn, repBalanceBeforeReturn + REP_BOND, "REP bond not returned")

		const marketOutcome = await getWinningOutcome(client, genesisUniverse, marketId)
		assert.strictEqual(marketOutcome, winningOutcome, "Winning outcome not as expected")
	})

	test('canInitialReport', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const otherClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await ensureZoltarDeployed(client)
		const zoltar = getZoltarAddress()
		const genesisUniverse = 0n

		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const endTime = curentTimestamp + DAY
		await createMarket(client, genesisUniverse, endTime, "test")

		const marketId = 1n
		const winningOutcome = 1n

		await mockWindow.advanceTime(DAY)

		// We can't report as a non designated reporter until their designated reporting period is over
		await assert.rejects(reportOutcome(otherClient, genesisUniverse, marketId, winningOutcome))

		await mockWindow.advanceTime(DAY * 3n + 1n)

		await reportOutcome(otherClient, genesisUniverse, marketId, winningOutcome)

		// We still need to wait for the market to go without a dispute for the dispute period before it is finalized
		const isFInalized = await isFinalized(client, genesisUniverse, marketId)
		assert.ok(!isFInalized, "Market incorrectly recognized as finalized")
		await assert.rejects(finalizeMarket(client, genesisUniverse, marketId))

		await mockWindow.advanceTime(DAY + 1n)

		const isFInalizedNow = await isFinalized(client, genesisUniverse, marketId)
		assert.ok(isFInalizedNow, "Market not recognized as finalized")

		// The REP bond can now be returned to the initial reporter
		const repBalanceBeforeReturn = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), otherClient.account.address)
		await finalizeMarket(client, genesisUniverse, marketId)
		const repBalanceAfterReturn = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), otherClient.account.address)
		assert.strictEqual(repBalanceAfterReturn, repBalanceBeforeReturn + REP_BOND, "REP bond not returned")
	})

	test('canForkMarket', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const client2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await ensureZoltarDeployed(client)
		const zoltar = getZoltarAddress()
		const genesisUniverse = 0n

		await approveToken(client2, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const endTime = curentTimestamp + DAY
		await createMarket(client, genesisUniverse, endTime, "test")

		const marketId = 1n

		// We'll create a second market and buy complete sets with both users as well
		await createMarket(client, genesisUniverse, endTime, "test 2")

		const marketId2 = 2n

		await mockWindow.advanceTime(DAY)

		const initialOutcome = 1n
		await reportOutcome(client, genesisUniverse, marketId, initialOutcome)

		// We'll also report on the second market
		await reportOutcome(client, genesisUniverse, marketId2, initialOutcome)

		const disputeOutcome = 2n
		await dispute(client2, genesisUniverse, marketId, disputeOutcome)

		// Three child universe now exist
		const invalidUniverseId = 1n
		const yesUniverseId = 2n
		const noUniverseId = 3n
		const invalidUniverseData = await getUniverseData(client, invalidUniverseId)
		const yesUniverseData = await getUniverseData(client, yesUniverseId)
		const noUniverseData = await getUniverseData(client, noUniverseId)
		const invalidREPToken = invalidUniverseData[0]
		const yesREPToken = yesUniverseData[0]
		const noREPToken = noUniverseData[0]

		assert.notEqual(invalidUniverseData[0], addressString(0n), 'invalid universe not recognized or not initialized properly')
		assert.notEqual(yesUniverseData[0], addressString(0n), 'yes universe not recognized or not initialized properly')
		assert.notEqual(noUniverseData[0], addressString(0n), 'no universe not recognized or not initialized properly')

		//The client balances of REP staked in the escalation game have migrated to the respective universe REP
		const client1YesREPBalance = await getERC20Balance(client, yesREPToken, client.account.address)
		const client2NoREPBalance = await getERC20Balance(client2, noREPToken, client2.account.address)
		assert.strictEqual(client1YesREPBalance, REP_BOND, "REP bond not migrated during fork")
		assert.strictEqual(client2NoREPBalance, REP_BOND * 2n, "Dispute bond not migrated during fork")

		// The forking market is resolved to each respective outcome in the child universes
		const invalidUniverseWinningOutcome = await getWinningOutcome(client, invalidUniverseId, marketId)
		const yesUniverseWinningOutcome = await getWinningOutcome(client, yesUniverseId, marketId)
		const noUniverseWinningOutcome = await getWinningOutcome(client, noUniverseId, marketId)

		assert.strictEqual(invalidUniverseWinningOutcome, 0n, "Invalid universe forking market outcome not as expected")
		assert.strictEqual(yesUniverseWinningOutcome, 1n, "Yes universe forking market outcome not as expected")
		assert.strictEqual(noUniverseWinningOutcome, 2n, "No universe forking market outcome not as expected")

		const disputeBond = REP_BOND * 2n

		// migrate unstaked REP from client 1
		const client1REPBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		const repBurned = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), addressString(1n))
		await splitRep(client, genesisUniverse)

		const repBurnedAfterMigration = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), addressString(BURN_ADDRESS))
		assert.strictEqual(repBurnedAfterMigration, repBurned + client1REPBalance + REP_BOND + disputeBond, "REP not sent to burn address during migration")

		// TODO check balance of REP in child universes
		const client1InvalidREPBalanceAfterMigrate = await getERC20Balance(client, invalidREPToken, client.account.address)
		const client1YesREPBalanceAfterMigrate = await getERC20Balance(client, yesREPToken, client.account.address)
		const client1NoREPBalanceAfterMigrate = await getERC20Balance(client, noREPToken, client.account.address)
		assert.strictEqual(client1InvalidREPBalanceAfterMigrate, client1REPBalance, "REP not migrated to invalid as expected")
		assert.strictEqual(client1YesREPBalanceAfterMigrate, client1REPBalance + REP_BOND, "REP not migrated to yes as expected")
		assert.strictEqual(client1NoREPBalanceAfterMigrate, client1REPBalance, "REP not migrated to no as expected")

		// We can migrate the REP staked in the other market as well
		await splitStakedRep(client, genesisUniverse, marketId2)

		const client1InvalidREPBalanceAfterStakedMigrate = await getERC20Balance(client, invalidREPToken, client.account.address)
		const client1YesREPBalanceAfterStakedMigrate = await getERC20Balance(client, yesREPToken, client.account.address)
		const client1NoREPBalanceAfterStakedMigrate = await getERC20Balance(client, noREPToken, client.account.address)
		assert.strictEqual(client1InvalidREPBalanceAfterStakedMigrate, client1REPBalance + REP_BOND, "staked REP not migrated to invalid as expected")
		assert.strictEqual(client1YesREPBalanceAfterStakedMigrate, client1REPBalance + REP_BOND * 2n, "staked REP not migrated to yes as expected")
		assert.strictEqual(client1NoREPBalanceAfterStakedMigrate, client1REPBalance + REP_BOND, "staked REP not migrated to no as expected")
	})
})
