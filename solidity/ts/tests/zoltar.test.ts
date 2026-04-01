import { test, beforeEach, describe, setDefaultTimeout } from 'bun:test'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { approveToken, setupTestAccounts, getERC20Balance, getChildUniverseId, contractExists, sortStringArrayByKeccak } from '../testsuite/simulator/utils/utilities'
import assert from 'node:assert'
import { addressString } from '../testsuite/simulator/utils/bigint'
import { addRepToMigrationBalance, deployChild, ensureZoltarDeployed, forkUniverse, getMigrationRepBalance, getRepTokenAddress, getTotalTheoreticalSupply, getUniverseData, getZoltarAddress, isZoltarDeployed, splitMigrationRep } from '../testsuite/simulator/utils/contracts/zoltar'
import { createQuestion, getAnswerOptionName, getQuestionId } from '../testsuite/simulator/utils/contracts/zoltarQuestionData'
import { ensureDefined } from '../testsuite/simulator/utils/testUtils'
import { Zoltar_Zoltar } from '../types/contractArtifact'
import { formatScalarOutcomeLabel, getScalarOutcomeIndex } from '../testsuite/simulator/utils/contracts/scalarOutcome'

// Forker deposit fractions: deposit is 5% of total supply (1/20), and 20% of that deposit is burned (1/5 of deposit)
const FORKER_DEPOSIT_FRACTION = 20n

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('Contract Test Suite', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const genesisUniverse = 0n

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
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

		const questionId = getQuestionId(questionData, outcomes)

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
		const balance = await getMigrationRepBalance(client, genesisUniverse, client.account.address)
		await splitMigrationRep(client, genesisUniverse, balance, outcomeIndexes)

		assert.strictEqual(await getERC20Balance(client, genesisRepToken, zoltar), 0n, "forker's deposit should be burned")
		for (const index of outcomeIndexes) {
			const indexUniverse = getChildUniverseId(genesisUniverse, index)
			const repForIndex = getRepTokenAddress(indexUniverse)
			assert.ok(await contractExists(client, repForIndex), `rep token for index ${ index } exists`)
			const ourBalance = await getERC20Balance(client, repForIndex, client.account.address)
			assert.strictEqual(ourBalance, await getMigrationRepBalance(client, genesisUniverse, client.account.address))
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
		await addRepToMigrationBalance(client, genesisUniverse, priorSplitBalance)
		await splitMigrationRep(client, genesisUniverse, priorSplitBalance, splitOutcomeIndexes)

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

	test('deployChild creates a child universe without requiring migration balance', async () => {
		const zoltar = getZoltarAddress()
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const questionData = {
			title: 'deploy child test',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)
		await forkUniverse(client, genesisUniverse, questionId)

		// Use a second account that has no migration balance to call deployChild.
		// This verifies the property createZoltarChildUniverse in the UI relies on:
		// any caller can deploy a child universe regardless of migration balance.
		const deployer = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const deployerMigrationBalance = await getMigrationRepBalance(deployer, genesisUniverse, deployer.account.address)
		assert.strictEqual(deployerMigrationBalance, 0n, 'deployer should have no migration balance')

		const outcomeIndex = 0n
		await deployChild(deployer, genesisUniverse, outcomeIndex)

		const childUniverseId = getChildUniverseId(genesisUniverse, outcomeIndex)
		const childRepToken = getRepTokenAddress(childUniverseId)
		assert.ok(await contractExists(deployer, childRepToken), 'child universe rep token should be deployed after deployChild')

		const childUniverseData = await getUniverseData(deployer, childUniverseId)
		assert.strictEqual(childUniverseData.forkingOutcomeIndex, outcomeIndex, 'child universe should record the correct outcome index')
		assert.strictEqual(childUniverseData.parentUniverseId, genesisUniverse, 'child universe should point back to the parent')
	})

	test('getDeployedChildUniverses pages deployed child universes', async () => {
		const zoltar = getZoltarAddress()
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const questionData = {
			title: 'paged child universes',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Outcome 1', 'Outcome 2', 'Outcome 3', 'Outcome 4'])
		await createQuestion(client, questionData, outcomes)
		const questionId = getQuestionId(questionData, outcomes)

		await forkUniverse(client, genesisUniverse, questionId)
		const balance = await getMigrationRepBalance(client, genesisUniverse, client.account.address)
		await splitMigrationRep(client, genesisUniverse, balance, [0, 1, 3])

		const firstPage = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'getDeployedChildUniverses',
			address: getZoltarAddress(),
			args: [genesisUniverse, 0n, 2n],
		})
		const secondPage = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'getDeployedChildUniverses',
			address: getZoltarAddress(),
			args: [genesisUniverse, 2n, 2n],
		})
		const emptyPage = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'getDeployedChildUniverses',
			address: getZoltarAddress(),
			args: [genesisUniverse, 4n, 2n],
		})

		assert.deepStrictEqual(firstPage[0], [0n, 1n], 'first page should include the first two child outcomes')
		assert.deepStrictEqual(firstPage[1], [getChildUniverseId(genesisUniverse, 0), getChildUniverseId(genesisUniverse, 1)], 'first page child ids should match deployed children')
		assert.deepStrictEqual(
			firstPage[2].map(child => child.parentUniverseId),
			[genesisUniverse, genesisUniverse],
			'first page child universes should point back to genesis',
		)

		assert.deepStrictEqual(secondPage[0], [3n], 'second page should include the remaining child outcome')
		assert.deepStrictEqual(secondPage[1], [getChildUniverseId(genesisUniverse, 3)], 'second page child id should match the deployed child')
		assert.strictEqual(secondPage[2][0]?.forkingOutcomeIndex, 3n, 'second page child universe should retain the outcome index')

		assert.deepStrictEqual(emptyPage[0], [], 'out of range paging should return no outcome indexes')
		assert.deepStrictEqual(emptyPage[1], [], 'out of range paging should return no child universe ids')
		assert.deepStrictEqual(emptyPage[2], [], 'out of range paging should return no child universes')
	})

	test('scalar slider values match the contract', async () => {
		const questionData = {
			title: 'scalar slider preview',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 1000n,
			displayValueMin: -500n * 10n ** 18n,
			displayValueMax: 500n * 10n ** 18n,
			answerUnit: 'km',
		}
		await createQuestion(client, questionData, [])
		const questionId = getQuestionId(questionData, [])

		for (const tickIndex of [0n, 250n, 500n, 750n, 1000n]) {
			const outcomeIndex = getScalarOutcomeIndex(questionData, tickIndex)
			const helperLabel = formatScalarOutcomeLabel(questionData, tickIndex)
			const contractLabel = await getAnswerOptionName(client, questionId, outcomeIndex)
			assert.strictEqual(helperLabel, contractLabel, `tick ${ tickIndex.toString() } should match the contract`)
		}

		const unevenQuestionData = {
			title: 'scalar uneven preview',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 3n,
			displayValueMin: 0n,
			displayValueMax: 10n * 10n ** 18n,
			answerUnit: 'km',
		}
		await createQuestion(client, unevenQuestionData, [])
		const unevenQuestionId = getQuestionId(unevenQuestionData, [])

		for (const tickIndex of [0n, 1n, 2n, 3n]) {
			const outcomeIndex = getScalarOutcomeIndex(unevenQuestionData, tickIndex)
			const helperLabel = formatScalarOutcomeLabel(unevenQuestionData, tickIndex)
			const contractLabel = await getAnswerOptionName(client, unevenQuestionId, outcomeIndex)
			assert.strictEqual(helperLabel, contractLabel, `uneven tick ${ tickIndex.toString() } should match the contract`)
		}
		assert.strictEqual(formatScalarOutcomeLabel(unevenQuestionData, 3n), '10 km', 'the max tick should now hit the exact maximum value')
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

		// Create a question that ends in the future, then advance time past its end.
		const currentTime = await mockWindow.getTime()
		const futureEndTime = currentTime + 1000n

		const questionData = {
			title: 'past question',
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
		await mockWindow.advanceTime(2000n)

		// Fork should succeed
		await forkUniverse(client, genesisUniverse, questionId)

		// Verify fork succeeded
		const universeData = await getUniverseData(client, genesisUniverse)
		assert.ok(universeData.forkTime > 0n, 'Universe should be forked')
		assert.strictEqual(universeData.forkQuestionId, questionId, 'Fork questionId mismatch')
	})

	test('splitMigrationRep fails for malformed outcome index', async () => {
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
		const balance = await getMigrationRepBalance(client, genesisUniverse, client.account.address)

		// Try to migrate with a malformed outcome index (5 is > 4 outcomes)
		const malformedOutcomeIndex = 5n
		await assert.rejects(splitMigrationRep(client, genesisUniverse, balance, [malformedOutcomeIndex]), /Malformed/)
	})
})
