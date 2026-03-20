import { test, beforeEach, describe } from 'bun:test'
import { getMockedEthSimulateWindowEthereum, AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { approveToken, setupTestAccounts, getERC20Balance, getChildUniverseId, contractExists } from '../testsuite/simulator/utils/utilities'
import assert from 'node:assert'
import { addressString } from '../testsuite/simulator/utils/bigint'
import { ensureZoltarDeployed, forkerClaimRep, forkUniverse, getRepTokenAddress, getTotalTheoreticalSupply, getUniverseData, getUniverseForkData, getZoltarAddress, isZoltarDeployed, splitRep, getZoltarQuestionDataAddress } from '../testsuite/simulator/utils/contracts/zoltar'
import { createQuestion } from '../testsuite/simulator/utils/contracts/zoltarQuestionData'
import { ensureDefined } from '../testsuite/simulator/utils/testUtils'
import { keccak256, encodeAbiParameters } from 'viem'
import { ZoltarQuestionData_ZoltarQuestionData } from '../types/contractArtifact'

// Forker deposit fractions: deposit is 5% of total supply (1/20), and 20% of that deposit is burned (1/5 of deposit)
const FORKER_DEPOSIT_FRACTION = 20n
const FORKER_BURN_FRACTION = 5n

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
		const marketText = 'test market'
		const outcomes = ['Outcome 1', 'Outcome 2', 'Outcome 3', 'Outcome 4']

		await approveToken(client2, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		// Create the question on ZoltarQuestionData
		const questionData = {
			title: marketText,
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

		// Compute questionId for the market
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
		const universeForkData = await getUniverseForkData(client, genesisUniverse)
		assert.strictEqual(universeForkData.forkedBy, client.account.address, 'We should have been the forker')
		const forkerDeposit = totalTheoreticalSupply / FORKER_DEPOSIT_FRACTION - totalTheoreticalSupply / FORKER_DEPOSIT_FRACTION / FORKER_BURN_FRACTION // 5% of supply minus 20% burn
		assert.strictEqual(universeForkData.forkerRepDeposit, forkerDeposit, 'wrong deposit amount')
		assert.strictEqual(universeForkData.questionId, questionId, 'Question ID did not match')
		assert.strictEqual(await getERC20Balance(client, genesisRepToken, zoltar), 0n, "forker's deposit should be burned (not held)")

		// Verify outcomes via ZoltarQuestionData.getForkingData
		const forkData = await client.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'getForkingData',
			address: getZoltarQuestionDataAddress(),
			args: [questionId],
		})
		const [, fetchedOutcomes] = forkData
		assert.deepStrictEqual([...fetchedOutcomes], [...outcomes], 'Outcomes did not match')

		// forker claim balance
		const outcomeIndexes = [0, 1, 3]
		await forkerClaimRep(client, genesisUniverse, outcomeIndexes)
		assert.strictEqual(await getERC20Balance(client, genesisRepToken, zoltar), 0n, "forker's deposit should be burned")
		const universeForkDataAfterClaim = await getUniverseForkData(client, genesisUniverse)
		assert.strictEqual(universeForkDataAfterClaim.forkerRepDeposit, forkerDeposit, 'deposit should still be available')
		for (const index of outcomeIndexes) {
			const indexUniverse = getChildUniverseId(genesisUniverse, index)
			const repForIndex = getRepTokenAddress(indexUniverse)
			assert.ok(await contractExists(client, repForIndex), `rep token for index ${index} exists`)
			const ourBalance = await getERC20Balance(client, repForIndex, client.account.address)
			assert.strictEqual(ourBalance, forkerDeposit)
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
		await splitRep(client, genesisUniverse, splitOutcomeIndexes)
		assert.strictEqual(await getERC20Balance(client, genesisRepToken, client.account.address), 0n, "splitter's rep should be gone")
		for (const [index, outcomeIndex] of splitOutcomeIndexes.entries()) {
			const indexUniverse = getChildUniverseId(genesisUniverse, outcomeIndex)
			const repForIndex = getRepTokenAddress(indexUniverse)
			assert.ok(await contractExists(client, repForIndex), `rep token for index ${outcomeIndex} exists`)
			const priorBalance = ensureDefined(priorBalances[index], `priorBalance at index ${index} is undefined`)
			const ourBalance = await getERC20Balance(client, repForIndex, client.account.address)
			assert.strictEqual(ourBalance, priorSplitBalance + priorBalance, 'after split balance mismatch')
		}
	})
})
