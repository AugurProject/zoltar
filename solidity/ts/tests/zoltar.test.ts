import { test, beforeEach, describe } from 'bun:test'
import { getMockedEthSimulateWindowEthereum, AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { approveToken, setupTestAccounts, getERC20Balance, getChildUniverseId, contractExists, sortStringArrayByKeccak } from '../testsuite/simulator/utils/utilities'
import assert from 'node:assert'
import { addressString } from '../testsuite/simulator/utils/bigint'
import { ensureZoltarDeployed, forkUniverse, getRepTokenAddress, getTotalTheoreticalSupply, getUniverseData, getZoltarAddress, isZoltarDeployed, getRepTokensMigratedRepBalance, migrateInternalRep, prepareRepForMigration } from '../testsuite/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../testsuite/simulator/utils/contracts/zoltarQuestionData'
import { ensureDefined } from '../testsuite/simulator/utils/testUtils'
import { keccak256, encodeAbiParameters } from 'viem'

// Forker deposit fractions: deposit is 5% of total supply (1/20), and 20% of that deposit is burned (1/5 of deposit)
const FORKER_DEPOSIT_FRACTION = 20n

describe('Contract Test Suite', () => {
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const genesisUniverse = 0n

	beforeEach(async () => {
		mockWindow = await getMockedEthSimulateWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
	})

	test('canDeployContract', async () => {
		const isDeployed = await isZoltarDeployed(client)
		assert.ok(isDeployed, 'Not Deployed!')

		const genesisUniverseData = await getUniverseData(client, 0n)
		assert.strictEqual(BigInt(genesisUniverseData.reputationToken), GENESIS_REPUTATION_TOKEN, 'Genesis universe not recognized or not initialized properly')
	})

	test('canForkQuestion', async () => {
		const client2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const zoltar = getZoltarAddress()
		const questionText = 'test question'
		const outcomes = sortStringArrayByKeccak(['Outcome 1', 'Outcome 2', 'Outcome 3', 'Outcome 4'])

		await approveToken(client2, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		// Create the question on ZoltarQuestionData
		const questionData = {
			title: questionText,
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		await createQuestion(client, questionData, outcomes)

		const preForkUniverseData = await getUniverseData(client, genesisUniverse)
		const genesisRepToken = getRepTokenAddress(genesisUniverse)
		const totalTheoreticalSupply = await getTotalTheoreticalSupply(client, genesisRepToken)
		assert.strictEqual(preForkUniverseData.forkTime, 0n, 'Universe was forked already')
		assert.strictEqual(preForkUniverseData.parentUniverseId, 0n, 'Universe had parent')
		assert.strictEqual(preForkUniverseData.forkingOutcomeIndex, 0n, 'Universe has forking outcome index')
		assert.strictEqual(preForkUniverseData.reputationToken, genesisRepToken, 'Universe reputation token mismatch')
		const priorRepbalance = await getERC20Balance(client, genesisRepToken, client.account.address)

		// Compute questionId for the question
		const questionId = BigInt(
			keccak256(
				encodeAbiParameters(
					[
						{
							name: 'questionData',
							type: 'tuple',
							components: [
								{ name: 'title', type: 'string' },
								{ name: 'description', type: 'string' },
								{ name: 'startTime', type: 'uint256' },
								{ name: 'endTime', type: 'uint256' },
								{ name: 'numTicks', type: 'uint256' },
								{ name: 'displayValueMin', type: 'int256' },
								{ name: 'displayValueMax', type: 'int256' },
								{ name: 'answerUnit', type: 'string' },
							],
						},
						{ name: 'outcomeOptions', type: 'string[]' },
					],
					[questionData, outcomes],
				),
			),
		)

		// do fork
		await forkUniverse(client, genesisUniverse, questionId)
		const afterForkBalance = await getERC20Balance(client, genesisRepToken, client.account.address)
		assert.strictEqual(afterForkBalance + totalTheoreticalSupply / FORKER_DEPOSIT_FRACTION, priorRepbalance, 'balance mismatch')
		const universeData = await getUniverseData(client, genesisUniverse)
		assert.ok(universeData.forkTime > 0, 'Universe was supposed to be forked')
		assert.strictEqual(universeData.parentUniverseId, 0n, 'Universe had parent')
		assert.strictEqual(universeData.forkingOutcomeIndex, 0n, 'Universe has forking outcome index')
		assert.strictEqual(universeData.reputationToken, genesisRepToken, 'Wrong rep token')
		ensureDefined(client.account, 'client.account is undefined')
		assert.strictEqual(await getERC20Balance(client, genesisRepToken, zoltar), 0n, "forker's deposit should be burned (not held)")

		// forker claim balance
		const outcomeIndexes = [0, 1, 3]
		const balance = await getRepTokensMigratedRepBalance(client, genesisUniverse, client.account.address)
		await migrateInternalRep(client, genesisUniverse, balance, outcomeIndexes)

		assert.strictEqual(await getERC20Balance(client, genesisRepToken, zoltar), 0n, "forker's deposit should be burned")
		for (const index of outcomeIndexes) {
			const indexUniverse = getChildUniverseId(genesisUniverse, index)
			const repForIndex = getRepTokenAddress(indexUniverse)
			assert.ok(await contractExists(client, repForIndex), `rep token for index ${ index } exists`)
			const ourBalance = await getERC20Balance(client, repForIndex, client.account.address)
			assert.strictEqual(ourBalance, await getRepTokensMigratedRepBalance(client, genesisUniverse, client.account.address))
		}

		// split rest of the rep
		const splitOutcomeIndexes = [0, 1, 2]
		const priorBalances = await Promise.all(
			splitOutcomeIndexes.map(async index => {
				const indexUniverse = getChildUniverseId(genesisUniverse, index)
				const repForIndex = getRepTokenAddress(indexUniverse)
				return (await contractExists(client, repForIndex)) ? await getERC20Balance(client, repForIndex, client.account.address) : 0n
			}),
		)
		const priorSplitBalance = await getERC20Balance(client, genesisRepToken, client.account.address)
		await prepareRepForMigration(client, genesisUniverse, priorSplitBalance)
		await migrateInternalRep(client, genesisUniverse, priorSplitBalance, splitOutcomeIndexes)

		assert.strictEqual(await getERC20Balance(client, genesisRepToken, client.account.address), 0n, "splitter's rep should be gone")
		for (const [index, outcomeIndex] of splitOutcomeIndexes.entries()) {
			const indexUniverse = getChildUniverseId(genesisUniverse, outcomeIndex)
			const repForIndex = getRepTokenAddress(indexUniverse)
			assert.ok(await contractExists(client, repForIndex), `rep token for index ${ outcomeIndex } exists`)
			const priorBalance = ensureDefined(priorBalances[index], `priorBalance at index ${ index } is undefined`)
			const ourBalance = await getERC20Balance(client, repForIndex, client.account.address)
			assert.strictEqual(ourBalance, priorSplitBalance + priorBalance, 'after split balance mismatch')
		}
	})

	test('forkUniverse fails for non-existent question', async () => {
		const client2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const zoltar = getZoltarAddress()
		await approveToken(client2, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const nonExistentQuestionId = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn

		await assert.rejects(forkUniverse(client, genesisUniverse, nonExistentQuestionId), /Question does not exist/)
	})

	test('forkUniverse fails when question has not ended', async () => {
		const client2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const zoltar = getZoltarAddress()
		await approveToken(client2, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		// Get current time and create a question that ends in the future
		const currentTime = await mockWindow.getTime()
		const futureEndTime = currentTime + 1000n

		const questionData = {
			title: 'future question',
			description: '',
			startTime: 0n,
			endTime: futureEndTime,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = ['Yes', 'No']
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)

		// Should fail because question hasn't ended
		await assert.rejects(forkUniverse(client, genesisUniverse, questionId), /Question has not ended/)

		// Advance time past the endTime
		await mockWindow.advanceTime(2000n)

		// Should succeed now
		await forkUniverse(client, genesisUniverse, questionId)
	})

	test('forkUniverse succeeds when question has ended', async () => {
		const client2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const zoltar = getZoltarAddress()
		await approveToken(client2, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		// Get current time and create a question that already ended
		const currentTime = await mockWindow.getTime()
		const pastEndTime = currentTime - 1000n

		const questionData = {
			title: 'past question',
			description: '',
			startTime: 0n,
			endTime: pastEndTime,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = ['Yes', 'No']
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)

		// Fork should succeed
		await forkUniverse(client, genesisUniverse, questionId)

		// Verify fork succeeded
		const universeData = await getUniverseData(client, genesisUniverse)
		assert.ok(universeData.forkTime > 0n, 'Universe should be forked')
		assert.strictEqual(universeData.forkQuestionId, questionId, 'Fork questionId mismatch')
	})

	test('migrateInternalRep fails for malformed outcome index', async () => {
		const client2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const zoltar = getZoltarAddress()
		await approveToken(client2, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		// Create a question with 4 outcomes
		const questionData = {
			title: 'test malformed outcome',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = ['Yes', 'No']
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)

		// Fork the universe
		await forkUniverse(client, genesisUniverse, questionId)

		// Get the balance available for migration
		const balance = await getRepTokensMigratedRepBalance(client, genesisUniverse, client.account.address)

		// Try to migrate with a malformed outcome index (5 is > 4 outcomes)
		const malformedOutcomeIndex = 5n
		await assert.rejects(migrateInternalRep(client, genesisUniverse, balance, [malformedOutcomeIndex]), /Malformed/)
	})
})
