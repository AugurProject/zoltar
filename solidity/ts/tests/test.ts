import { describe, beforeEach, test } from 'node:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient } from '../testsuite/simulator/utils/viem.js'
import { BURN_ADDRESS, DAY, GENESIS_REPUTATION_TOKEN, REP_BOND, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { approveToken, createQuestion, ensureZoltarDeployed, getERC20Balance, getQuestionData, getZoltarAddress, getUniverseData, initialTokenBalance, isZoltarDeployed, setupTestAccounts, reportOutcome, isFinalized, finalizeQuestion, getWinningOutcome, dispute, splitRep, splitStakedRep } from '../testsuite/simulator/utils/utilities.js'
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

	test('canCreateQuestion', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await ensureZoltarDeployed(client)
		const zoltar = getZoltarAddress()
		const genesisUniverse = 0n

		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const repBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		assert.strictEqual(repBalance, initialTokenBalance, "REP not initially minted")

		const endTime = curentTimestamp + DAY
		await createQuestion(client, genesisUniverse, endTime, "test")

		const questionId = 1n
		const questionData = await getQuestionData(client, questionId)

		assert.strictEqual(questionData[0], endTime, 'Question endTime not as expected')
		assert.strictEqual(questionData[1], genesisUniverse, 'Question origin universe not as expected')
		assert.strictEqual(questionData[2].toLowerCase(), client.account.address, 'Question designated reporter not as expected')
		assert.strictEqual(questionData[3], "test", 'Question extraInfo not as expected')
	})

	test('canResolveQuestion', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await ensureZoltarDeployed(client)
		const zoltar = getZoltarAddress()
		const genesisUniverse = 0n

		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const endTime = curentTimestamp + DAY
		await createQuestion(client, genesisUniverse, endTime, "test")

		const questionId = 1n
		const winningOutcome = 1n

		// We can't report until the question has reached its end time
		await assert.rejects(reportOutcome(client, genesisUniverse, questionId, winningOutcome))

		await mockWindow.advanceTime(DAY)

		await reportOutcome(client, genesisUniverse, questionId, winningOutcome)

		const isFInalized = await isFinalized(client, genesisUniverse, questionId)
		assert.ok(!isFInalized, "Question incorrectly recognized as finalized")
		await assert.rejects(finalizeQuestion(client, genesisUniverse, questionId))

		await mockWindow.advanceTime(DAY + 1n)

		const isFInalizedNow = await isFinalized(client, genesisUniverse, questionId)
		assert.ok(isFInalizedNow, "Question not recognized as finalized")

		const repBalanceBeforeReturn = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await finalizeQuestion(client, genesisUniverse, questionId)
		const repBalanceAfterReturn = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		assert.strictEqual(repBalanceAfterReturn, repBalanceBeforeReturn + REP_BOND, "REP bond not returned")

		const questionOutcome = await getWinningOutcome(client, genesisUniverse, questionId)
		assert.strictEqual(questionOutcome, winningOutcome, "Winning outcome not as expected")
	})

	test('canInitialReport', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const otherClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await ensureZoltarDeployed(client)
		const zoltar = getZoltarAddress()
		const genesisUniverse = 0n

		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const endTime = curentTimestamp + DAY
		await createQuestion(client, genesisUniverse, endTime, "test")

		const questionId = 1n
		const winningOutcome = 1n

		await mockWindow.advanceTime(DAY)

		// We can't report as a non designated reporter until their designated reporting period is over
		await assert.rejects(reportOutcome(otherClient, genesisUniverse, questionId, winningOutcome))

		await mockWindow.advanceTime(DAY * 3n + 1n)

		await reportOutcome(otherClient, genesisUniverse, questionId, winningOutcome)

		// We still need to wait for the question to go without a dispute for the dispute period before it is finalized
		const isFInalized = await isFinalized(client, genesisUniverse, questionId)
		assert.ok(!isFInalized, "Question incorrectly recognized as finalized")
		await assert.rejects(finalizeQuestion(client, genesisUniverse, questionId))

		await mockWindow.advanceTime(DAY + 1n)

		const isFInalizedNow = await isFinalized(client, genesisUniverse, questionId)
		assert.ok(isFInalizedNow, "Question not recognized as finalized")

		// The REP bond can now be returned to the initial reporter
		const repBalanceBeforeReturn = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), otherClient.account.address)
		await finalizeQuestion(client, genesisUniverse, questionId)
		const repBalanceAfterReturn = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), otherClient.account.address)
		assert.strictEqual(repBalanceAfterReturn, repBalanceBeforeReturn + REP_BOND, "REP bond not returned")
	})

	test('canForkQuestion', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const client2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await ensureZoltarDeployed(client)
		const zoltar = getZoltarAddress()
		const genesisUniverse = 0n

		await approveToken(client2, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const endTime = curentTimestamp + DAY
		await createQuestion(client, genesisUniverse, endTime, "test")

		const questionId = 1n

		// We'll create a second question and buy complete sets with both users as well
		await createQuestion(client, genesisUniverse, endTime, "test 2")

		const questionId2 = 2n

		await mockWindow.advanceTime(DAY)

		const initialOutcome = 1n
		await reportOutcome(client, genesisUniverse, questionId, initialOutcome)

		// We'll also report on the second question
		await reportOutcome(client, genesisUniverse, questionId2, initialOutcome)

		const disputeOutcome = 2n
		await dispute(client2, genesisUniverse, questionId, disputeOutcome)

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

		// The forking question is resolved to each respective outcome in the child universes
		const invalidUniverseWinningOutcome = await getWinningOutcome(client, invalidUniverseId, questionId)
		const yesUniverseWinningOutcome = await getWinningOutcome(client, yesUniverseId, questionId)
		const noUniverseWinningOutcome = await getWinningOutcome(client, noUniverseId, questionId)

		assert.strictEqual(invalidUniverseWinningOutcome, 0n, "Invalid universe forking question outcome not as expected")
		assert.strictEqual(yesUniverseWinningOutcome, 1n, "Yes universe forking question outcome not as expected")
		assert.strictEqual(noUniverseWinningOutcome, 2n, "No universe forking question outcome not as expected")

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

		// We can migrate the REP staked in the other question as well
		await splitStakedRep(client, genesisUniverse, questionId2)

		const client1InvalidREPBalanceAfterStakedMigrate = await getERC20Balance(client, invalidREPToken, client.account.address)
		const client1YesREPBalanceAfterStakedMigrate = await getERC20Balance(client, yesREPToken, client.account.address)
		const client1NoREPBalanceAfterStakedMigrate = await getERC20Balance(client, noREPToken, client.account.address)
		assert.strictEqual(client1InvalidREPBalanceAfterStakedMigrate, client1REPBalance + REP_BOND, "staked REP not migrated to invalid as expected")
		assert.strictEqual(client1YesREPBalanceAfterStakedMigrate, client1REPBalance + REP_BOND * 2n, "staked REP not migrated to yes as expected")
		assert.strictEqual(client1NoREPBalanceAfterStakedMigrate, client1REPBalance + REP_BOND, "staked REP not migrated to no as expected")
	})
})
