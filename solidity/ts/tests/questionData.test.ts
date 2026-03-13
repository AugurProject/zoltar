import { test, beforeEach, describe } from 'bun:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar.js'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals.js'
import assert from 'node:assert'
import { combineUint256FromTwoWithInvalid, createQuestion, getAnswerOptionName, getOutcomeLabels, getQuestionData, getQuestionId, isMalformedAnswerOption } from '../testsuite/simulator/utils/contracts/zoltarQuestionData.js'
import { areEqualArrays } from '../testsuite/simulator/utils/typed-arrays.js'
import { createTransactionExplainer } from '../testsuite/simulator/utils/transactionExplainer.js'
import { getDeployments } from '../testsuite/simulator/utils/contracts/deployments.js'
import { SimulationState } from '../testsuite/simulator/types/visualizerTypes.js'
import { copySimulationState } from '../testsuite/simulator/SimulationModeEthereumClientService.js'

describe('Question Data', () => {
	let mockWindow: MockWindowEthereum
	let client: WriteClient

	let cachedSimulationState: SimulationState | undefined = undefined

	beforeEach(async () => {
		if (cachedSimulationState) {
			mockWindow = getMockedEthSimulateWindowEthereum(true, copySimulationState(cachedSimulationState))
			mockWindow.setAfterTransactionSendCallBack(createTransactionExplainer(getDeployments()))
			client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		} else {
			mockWindow = getMockedEthSimulateWindowEthereum()
			client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
			mockWindow.setAfterTransactionSendCallBack(createTransactionExplainer(getDeployments()))
			await setupTestAccounts(mockWindow)
			await ensureZoltarDeployed(client)
			await ensureInfraDeployed(client)
			const simulationState = mockWindow.getSimulationState()
			if (simulationState === null || simulationState === undefined) {
				throw new Error('Simulation state is not available after setup')
			}
			cachedSimulationState = copySimulationState(simulationState)
		}
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

		assert.ok(!await isMalformedAnswerOption(client, questionId, 0n), 'invalid is valid')
		assert.ok(!await isMalformedAnswerOption(client, questionId, 1n), 'Yes is valid')
		assert.ok(!await isMalformedAnswerOption(client, questionId, 2n), 'No is valid')
		assert.ok(await isMalformedAnswerOption(client, questionId, 3n), 'doesn\'t exist')

		assert.strictEqual(await getAnswerOptionName(client, questionId, 0n), 'Invalid', 'invalid is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, 1n), 'Yes', 'Yes is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, 2n), 'No', 'No is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, 3n), 'Malformed', 'doesn\'t exist')
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

	test('isMalformedAnswerOption: scalar answers - bug check for high bit set', async () => {
		// Create a scalar question
		const testScalarQuestion = {
			title: 'scalar',
			description: 'scalar',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: 1000n,
			displayValueMin: 0n,
			displayValueMax: 1000n,
			answerUnit: 'unit'
		}
		await createQuestion(client, testScalarQuestion, [])
		const questionId = await getQuestionId(client, testScalarQuestion, [])

		const encode = (invalid: boolean, first: bigint, second: bigint): bigint => {
			// from utils/contracts/zoltarQuestionData.ts: combineUint256FromTwoWithInvalid
			const PART_BIT_LENGTH = 120n
			const TOTAL_BITS = 256n
			const oneHundredTwentyBitMask = (1n << PART_BIT_LENGTH) - 1n
			const normalizedFirst = first & oneHundredTwentyBitMask
			const normalizedSecond = second & oneHundredTwentyBitMask
			const highestBit = invalid ? 0n : 1n
			return (highestBit << (TOTAL_BITS - 1n)) | (normalizedFirst << PART_BIT_LENGTH) | normalizedSecond
		}

		// A) high bit set, sum == numTicks -> valid -> not malformed (false)
		{
			const ans = encode(false, 600n, 400n)
			const malformed = await isMalformedAnswerOption(client, questionId, ans)
			assert.strictEqual(malformed, false, 'high bit + correct sum should be valid (not malformed)')
		}

		// B) high bit set, sum != numTicks -> malformed (true)
		{
			const ans = encode(false, 500n, 400n) // sum=900 != 1000
			const malformed = await isMalformedAnswerOption(client, questionId, ans)
			assert.strictEqual(malformed, true, 'high bit + wrong sum should be malformed')
		}

		// C) high bit clear (invalid=true), non-zero -> malformed (true)
		{
			const ans = encode(true, 100n, 900n)
			const malformed = await isMalformedAnswerOption(client, questionId, ans)
			assert.strictEqual(malformed, true, 'invalid flag + non-zero is malformed')
		}

		// D) high bit clear, both zero -> not malformed (false) (Invalid)
		{
			const ans = encode(true, 0n, 0n)
			const malformed = await isMalformedAnswerOption(client, questionId, ans)
			assert.strictEqual(malformed, false, 'invalid flag + both zero is Invalid (not malformed)')
		}
	})

	test('handles large numTicks without overflow', async () => {
		// This test demonstrates integer overflow vulnerability in isMalformedAnswerOption and getAnswerOptionName.
		// When numTicks >= 2^120, the sum of two uint120 parts can overflow, causing valid answers to be incorrectly rejected.
		const hugeNumTicks = (1n << 120n) + 1000n
		const testScalarQuestion = {
			title: 'Huge Scalar',
			description: 'testing overflow',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: hugeNumTicks,
			outcomeLabels: [],
			displayValueMin: 0n,
			displayValueMax: 1n,
			answerUnit: '',
		}
		await createQuestion(client, testScalarQuestion, [])
		const questionId = await getQuestionId(client, testScalarQuestion, [])

		// Encode a valid answer where firstPart + secondPart = numTicks, but the sum overflows uint120.
		const firstPart = (1n << 120n) - 1n // max uint120
		const secondPart = hugeNumTicks - firstPart // 1001
		assert.ok(secondPart > 0n && secondPart <= ((1n << 120n) - 1n), 'secondPart within uint120 range')
		const answer = combineUint256FromTwoWithInvalid(false, firstPart, secondPart)

		// Currently this fails due to overflow bug.
		const malformed = await isMalformedAnswerOption(client, questionId, answer)
		// Expected: false (not malformed). The bug causes overflow and returns true.
		assert.strictEqual(malformed, false, 'Valid answer with numTicks >= 2^120 incorrectly flagged as malformed due to overflow')

		// getAnswerOptionName should not return Malformed or Invalid
		const name = await getAnswerOptionName(client, questionId, answer)
		assert.notStrictEqual(name, 'Malformed', 'should not return Malformed')
		assert.notStrictEqual(name, 'Invalid', 'should not return Invalid')
	})
})
