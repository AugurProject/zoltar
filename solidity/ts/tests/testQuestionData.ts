import test, { beforeEach, describe } from 'node:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { createTransactionExplainer } from '../testsuite/simulator/utils/transactionExplainer.js'
import { getDeployments } from '../testsuite/simulator/utils/contracts/deployments.js'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar.js'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals.js'

describe('Question Data', () => {
	let mockWindow: MockWindowEthereum
	let client: WriteClient

	beforeEach(async () => {
		mockWindow = getMockedEthSimulateWindowEthereum()
		mockWindow.setAfterTransactionSendCallBack(createTransactionExplainer(getDeployments(genesisUniverse, marketId, securityMultiplier)))
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		//await mockWindow.setStartBLock(mockWindow.getTime)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
	})

	test('can make categorical question', async () => {
		type testCategoricalQuestion: QuestionData = {
			title: 'test categorical question',
			description: 'test categorical description',
			startTime: mockWindow.getTime() + 100000n
			endTime: mockWindow.getTime() + 200000n
			numTicks: 0n
			outcomeLabels: ['Yes', 'No']
			displayValueMin: 0n
			displayValueMax: 0n
			answerUnit: ''
		}

		await createQuestion(client, questionData)
		const questionId = await getQuestionId(client, testCategoricalQuestion)
		const data = await getQuestionData(client, questionId)
		assert.strictEqual(data.title, testCategoricalQuestion.title, 'title mismatch')
		assert.strictEqual(data.description, testCategoricalQuestion.description, 'description mismatch')
		assert.strictEqual(data.startTime, testCategoricalQuestion.startTime, 'startTime mismatch')
		assert.strictEqual(data.endTime, testCategoricalQuestion.endTime, 'endTime mismatch')
		assert.strictEqual(data.numTicks, testCategoricalQuestion.numTicks, 'numTicks mismatch')
		assert.strictEqual(data.outcomeLabels, testCategoricalQuestion.outcomeLabels, 'outcomeLabels mismatch')
		assert.strictEqual(data.displayValueMin, testCategoricalQuestion.displayValueMin, 'displayValueMin mismatch')
		assert.strictEqual(data.displayValueMax, testCategoricalQuestion.displayValueMax, 'displayValueMax mismatch')
		assert.strictEqual(data.answerUnit, testCategoricalQuestion.answerUnit, 'answerUnit mismatch')

		assert.ok(await isValidAnswerOption(client, questionId, 0n), 'invalid is valid')
		assert.ok(await isValidAnswerOption(client, questionId, 1n), 'Yes is valid')
		assert.ok(await isValidAnswerOption(client, questionId, 2n), 'No is valid')
		assert.ok(!(await isValidAnswerOption(client, questionId, 3n)), 'doesnt exist')

		assert.strictEqual(await getAnswerOptionName(client, questionId, 0n), 'Invalid', 'invalid is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, 1n), 'Yes', 'Yes is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, 2n), 'No', 'No is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, 3n), 'Malformed','doesnt exist')
	})

	test('can make scalar question', async () => {
		type testCategoricalQuestion: QuestionData = {
			title: 'test scalar question',
			description: 'test scalar description',
			startTime: mockWindow.getTime() + 100000n
			endTime: mockWindow.getTime() + 200000n
			numTicks: 1000n
			outcomeLabels: []
			displayValueMin: -500n
			displayValueMax: 500n
			answerUnit: 'km'
		}

		await createQuestion(client, questionData)
		const questionId = await getQuestionId(client, testCategoricalQuestion)
		const data = await getQuestionData(client, questionId)
		assert.strictEqual(data.title, testCategoricalQuestion.title, 'title mismatch')
		assert.strictEqual(data.description, testCategoricalQuestion.description, 'description mismatch')
		assert.strictEqual(data.startTime, testCategoricalQuestion.startTime, 'startTime mismatch')
		assert.strictEqual(data.endTime, testCategoricalQuestion.endTime, 'endTime mismatch')
		assert.strictEqual(data.numTicks, testCategoricalQuestion.numTicks, 'numTicks mismatch')
		assert.strictEqual(data.outcomeLabels, testCategoricalQuestion.outcomeLabels, 'outcomeLabels mismatch')
		assert.strictEqual(data.displayValueMin, testCategoricalQuestion.displayValueMin, 'displayValueMin mismatch')
		assert.strictEqual(data.displayValueMax, testCategoricalQuestion.displayValueMax, 'displayValueMax mismatch')
		assert.strictEqual(data.answerUnit, testCategoricalQuestion.answerUnit, 'answerUnit mismatch')

		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(true, 0, 0)), 'Invalid', 'should be invalid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(true, numTicks, 0)), 'Malformed', 'should be Malformed')
		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(false, 0, numTicks)), '-500 km', 'bottom is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(false, numTicks, 0)), '500 km', 'top is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(false, numTicks/2, numTicks/2)), '0 km', 'Middle is alid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(false, numTicks +1, 0)), 'Malformed', 'Overflow')
		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(false, 0, numTicks)), 'Malformed', 'Overflow')

	})
})
