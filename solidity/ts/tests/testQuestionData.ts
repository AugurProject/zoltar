import test, { beforeEach, describe } from 'node:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar.js'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals.js'
import assert from 'node:assert'
import { combineUint256FromTwoWithInvalid, createQuestion, getAnswerOptionName, getOutcomeLabels, getQuestionData, getQuestionId, isValidAnswerOption } from '../testsuite/simulator/utils/contracts/zoltarQuestionData.js'
import { areEqualArrays } from '../testsuite/simulator/utils/typed-arrays.js'
import { createTransactionExplainer } from '../testsuite/simulator/utils/transactionExplainer.js'
import { getDeployments } from '../testsuite/simulator/utils/contracts/deployments.js'

describe('Question Data', () => {
	let mockWindow: MockWindowEthereum
	let client: WriteClient

	beforeEach(async () => {
		mockWindow = getMockedEthSimulateWindowEthereum()
		mockWindow.setAfterTransactionSendCallBack(createTransactionExplainer(getDeployments()))
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
	})

	test('can make categorical question', async () => {
		const outcomeLabels = ['Yes', 'No']
		const testCategoricalQuestion = {
			title: 'test categorical question',
			description: 'test categorical description',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}

		await createQuestion(client, testCategoricalQuestion, outcomeLabels)
		const questionId = await getQuestionId(client, testCategoricalQuestion, outcomeLabels)
		const fetchedOutcomeLabels = await getOutcomeLabels(client, questionId)
		const data = await getQuestionData(client, questionId)
		assert.strictEqual(data.title, testCategoricalQuestion.title, 'title mismatch')
		assert.strictEqual(data.description, testCategoricalQuestion.description, 'description mismatch')
		assert.strictEqual(data.startTime, testCategoricalQuestion.startTime, 'startTime mismatch')
		assert.strictEqual(data.endTime, testCategoricalQuestion.endTime, 'endTime mismatch')
		assert.strictEqual(data.numTicks, testCategoricalQuestion.numTicks, 'numTicks mismatch')
		assert.ok(areEqualArrays(fetchedOutcomeLabels, outcomeLabels), 'outcomeLabels mismatch')
		assert.strictEqual(data.displayValueMin, testCategoricalQuestion.displayValueMin, 'displayValueMin mismatch')
		assert.strictEqual(data.displayValueMax, testCategoricalQuestion.displayValueMax, 'displayValueMax mismatch')
		assert.strictEqual(data.answerUnit, testCategoricalQuestion.answerUnit, 'answerUnit mismatch')

		assert.ok(await isValidAnswerOption(client, questionId, 0n), 'invalid is valid')
		assert.ok(await isValidAnswerOption(client, questionId, 1n), 'Yes is valid')
		assert.ok(await isValidAnswerOption(client, questionId, 2n), 'No is valid')
		assert.ok(!(await isValidAnswerOption(client, questionId, 3n)), 'doesn\'t exist')

		assert.strictEqual(await getAnswerOptionName(client, questionId, 0n), 'Invalid', 'invalid is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, 1n), 'Yes', 'Yes is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, 2n), 'No', 'No is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, 3n), 'Malformed','doesn\'t exist')
	})

	test('can make scalar question', async () => {
		const testScalarQuestion = {
			title: 'test scalar question',
			description: 'test scalar description',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: 1000n,
			outcomeLabels: [],
			displayValueMin: -500n * 10n ** 18n,
			displayValueMax: 500n * 10n ** 18n,
			answerUnit: 'km',
		}

		await createQuestion(client, testScalarQuestion, [])
		const questionId = await getQuestionId(client, testScalarQuestion, [])
		const data = await getQuestionData(client, questionId)
		const fetchedOutcomeLabels = await getOutcomeLabels(client, questionId)
		assert.strictEqual(data.title, testScalarQuestion.title, 'title mismatch')
		assert.strictEqual(data.description, testScalarQuestion.description, 'description mismatch')
		assert.strictEqual(data.startTime, testScalarQuestion.startTime, 'startTime mismatch')
		assert.strictEqual(data.endTime, testScalarQuestion.endTime, 'endTime mismatch')
		assert.strictEqual(data.numTicks, testScalarQuestion.numTicks, 'numTicks mismatch')
		assert.ok(areEqualArrays(fetchedOutcomeLabels, testScalarQuestion.outcomeLabels), 'outcomeLabels mismatch')
		assert.strictEqual(data.displayValueMin, testScalarQuestion.displayValueMin, 'displayValueMin mismatch')
		assert.strictEqual(data.displayValueMax, testScalarQuestion.displayValueMax, 'displayValueMax mismatch')
		assert.strictEqual(data.answerUnit, testScalarQuestion.answerUnit, 'answerUnit mismatch')

		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(true, 0n, 0n)), 'Invalid', 'should be invalid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(true, testScalarQuestion.numTicks, 0n)), 'Malformed', 'should be Malformed')
		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(false, testScalarQuestion.numTicks, 0n)), '-500 km', 'bottom is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(false, 0n, testScalarQuestion.numTicks)), '500 km', 'top is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(false, testScalarQuestion.numTicks / 2n, testScalarQuestion.numTicks / 2n)), '0 km', 'Middle is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(false, testScalarQuestion.numTicks + 1n, 0n)), 'Malformed', 'Overflow')
		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(false, 0n, testScalarQuestion.numTicks + 1n)), 'Malformed', 'Overflow')

	})
})
