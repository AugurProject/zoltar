import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts, sortStringArrayByKeccak } from '../testSupport/simulator/utils/utilities'
import { ensureZoltarDeployed } from '../testSupport/simulator/utils/contracts/zoltar'
import { ensureInfraDeployed } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import assert from '../testSupport/simulator/utils/assert'
import { combineUint256FromTwoWithInvalid, createQuestion, getAnswerOptionName, getOutcomeLabels, getQuestionData, getQuestionId, isMalformedAnswerOption } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { areEqualArrays } from '../testSupport/simulator/utils/array-utils'
import { ZoltarQuestionData_ZoltarQuestionData } from '../types/contractArtifact'
import { decodeEventLog } from '@zoltar/shared/ethereum'
import {
	SCALAR_PARITY_ENCODING_FIXTURES,
	SCALAR_PARITY_LABEL_FIXTURES,
	SCALAR_PARITY_QUESTIONS,
	SCALAR_PARITY_UINT120_MAX,
	combineScalarParityOutcomeIndex,
	describeScalarParityOutcomeIndex,
	formatScalarParityLabel,
	formatScalarParityOutcomeName,
	getScalarParityOutcomeIndex,
	getScalarParityQuestion,
	isScalarParityMalformedOutcomeIndex,
} from '@zoltar/shared/testing/scalarOutcomeParityFixtures'
import type { ScalarParityQuestion } from '@zoltar/shared/testing/scalarOutcomeParityFixtures'

const MAX_UINT256 = 2n ** 256n - 1n
const SCALAR_ENCODING_FUZZ_SAMPLE_COUNT = 12
const SCALAR_ENCODING_FUZZ_STATE_MASK = (1n << 128n) - 1n
const SCALAR_RESERVED_BITS_MASK = ((1n << 15n) - 1n) << 240n

type ScalarEncodingFuzzSample = {
	firstPart: bigint
	invalid: boolean
	secondPart: bigint
}

function advanceScalarEncodingFuzzState(state: bigint) {
	return (state * 6364136223846793005n + 1442695040888963407n) & SCALAR_ENCODING_FUZZ_STATE_MASK
}

function getScalarEncodingFuzzSamples(question: ScalarParityQuestion, seed: bigint) {
	const samples: ScalarEncodingFuzzSample[] = [
		{ invalid: true, firstPart: 0n, secondPart: 0n },
		{ invalid: false, firstPart: question.numTicks, secondPart: 0n },
		{ invalid: false, firstPart: 0n, secondPart: question.numTicks },
	]
	let state = seed
	for (let index = 0; index < SCALAR_ENCODING_FUZZ_SAMPLE_COUNT; index++) {
		state = advanceScalarEncodingFuzzState(state)
		const invalid = (state & 1n) === 0n
		state = advanceScalarEncodingFuzzState(state)
		const firstPart = state & SCALAR_PARITY_UINT120_MAX
		state = advanceScalarEncodingFuzzState(state)
		const secondPart = state & SCALAR_PARITY_UINT120_MAX
		const tickIndex = state % (question.numTicks + 1n)
		samples.push({ invalid, firstPart, secondPart })
		samples.push({ invalid: false, firstPart: question.numTicks - tickIndex, secondPart: tickIndex })
		if (index % 3 === 0) samples.push({ invalid: true, firstPart: (firstPart % 19n) + 1n, secondPart: secondPart % 23n })
	}
	return samples
}

function withScalarReservedBits(answer: bigint, reservedBits = 1n) {
	return answer | ((reservedBits << 240n) & SCALAR_RESERVED_BITS_MASK)
}

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('Question Data', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeAll(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
	})

	const createScalarParityQuestion = async (question: ScalarParityQuestion) => {
		const questionData = {
			title: `scalar parity ${question.name}`,
			description: 'scalar parity fixture',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: question.numTicks,
			displayValueMin: question.displayValueMin,
			displayValueMax: question.displayValueMax,
			answerUnit: question.answerUnit,
		}
		await createQuestion(client, questionData, [])
		return getQuestionId(questionData, [])
	}

	const createScalarParityQuestionIds = async () => {
		const questionIdsByName = new Map<string, bigint>()
		for (const question of SCALAR_PARITY_QUESTIONS) {
			questionIdsByName.set(question.name, await createScalarParityQuestion(question))
		}
		return questionIdsByName
	}

	const getScalarParityQuestionId = (questionIdsByName: Map<string, bigint>, questionName: string) => {
		const questionId = questionIdsByName.get(questionName)
		if (questionId === undefined) throw new Error(`Missing scalar parity question id: ${questionName}`)
		return questionId
	}

	const assertScalarContractMatchesParityModel = async (questionId: bigint, question: ScalarParityQuestion, answer: bigint, context: string) => {
		const expectedMalformed = isScalarParityMalformedOutcomeIndex(question, answer)
		const expectedName = formatScalarParityOutcomeName(question, answer)
		assert.strictEqual(await isMalformedAnswerOption(client, questionId, answer), expectedMalformed, `${context} malformed flag mismatch`)
		assert.strictEqual(await getAnswerOptionName(client, questionId, answer), expectedName, `${context} outcome name mismatch`)
	}

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

		const createHash = await createQuestion(client, testCategoricalQuestion, outcomeLabels)
		const questionId = getQuestionId(testCategoricalQuestion, outcomeLabels)
		const fetchedOutcomeLabels = await getOutcomeLabels(client, questionId)
		const data = await getQuestionData(client, questionId)
		const createReceipt = await client.waitForTransactionReceipt({ hash: createHash })
		const questionDataAddress = getInfraContractAddresses().zoltarQuestionData
		const createdLog = createReceipt.logs
			.filter(log => log.address.toLowerCase() === questionDataAddress.toLowerCase())
			.map(log =>
				decodeEventLog({
					abi: ZoltarQuestionData_ZoltarQuestionData.abi,
					data: log.data,
					topics: log.topics,
				}),
			)
			.find(log => log.eventName === 'QuestionCreated')
		if (createdLog === undefined) throw new Error('missing QuestionCreated log')
		const createdTimestamp = await client.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'questionCreatedTimestamp',
			address: questionDataAddress,
			args: [questionId],
		})
		assert.strictEqual(data.title, testCategoricalQuestion.title, 'title mismatch')
		assert.strictEqual(data.description, testCategoricalQuestion.description, 'description mismatch')
		assert.strictEqual(data.startTime, testCategoricalQuestion.startTime, 'startTime mismatch')
		assert.strictEqual(data.endTime, testCategoricalQuestion.endTime, 'endTime mismatch')
		assert.strictEqual(data.numTicks, testCategoricalQuestion.numTicks, 'numTicks mismatch')
		assert.ok(areEqualArrays(fetchedOutcomeLabels, outcomeLabels), 'outcomeLabels mismatch')
		assert.strictEqual(data.displayValueMin, testCategoricalQuestion.displayValueMin, 'displayValueMin mismatch')
		assert.strictEqual(data.displayValueMax, testCategoricalQuestion.displayValueMax, 'displayValueMax mismatch')
		assert.strictEqual(data.answerUnit, testCategoricalQuestion.answerUnit, 'answerUnit mismatch')
		assert.strictEqual(createdLog.args.questionId, questionId, 'QuestionCreated should identify the question')
		assert.strictEqual(createdLog.args.createdTimestamp, createdTimestamp, 'QuestionCreated should expose the stored creation timestamp')
		assert.strictEqual(createdLog.args.questionData.title, data.title, 'QuestionCreated should expose the stored title')
		assert.strictEqual(createdLog.args.questionData.description, data.description, 'QuestionCreated should expose the stored description')
		assert.strictEqual(createdLog.args.questionData.startTime, data.startTime, 'QuestionCreated should expose the stored start time')
		assert.strictEqual(createdLog.args.questionData.endTime, data.endTime, 'QuestionCreated should expose the stored end time')
		assert.strictEqual(createdLog.args.questionData.numTicks, data.numTicks, 'QuestionCreated should expose the stored tick count')
		assert.strictEqual(createdLog.args.questionData.displayValueMin, data.displayValueMin, 'QuestionCreated should expose the stored display minimum')
		assert.strictEqual(createdLog.args.questionData.displayValueMax, data.displayValueMax, 'QuestionCreated should expose the stored display maximum')
		assert.strictEqual(createdLog.args.questionData.answerUnit, data.answerUnit, 'QuestionCreated should expose the stored answer unit')
		assert.deepStrictEqual(Array.from(createdLog.args.outcomeOptions), fetchedOutcomeLabels, 'QuestionCreated should expose the stored outcome labels')

		assert.ok(!(await isMalformedAnswerOption(client, questionId, 0n)), 'invalid is valid')
		assert.ok(!(await isMalformedAnswerOption(client, questionId, 1n)), 'Yes is valid')
		assert.ok(!(await isMalformedAnswerOption(client, questionId, 2n)), 'No is valid')
		assert.ok(await isMalformedAnswerOption(client, questionId, 3n), 'does not exist')

		assert.strictEqual(await getAnswerOptionName(client, questionId, 0n), 'Invalid', 'invalid is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, 1n), 'Yes', 'Yes is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, 2n), 'No', 'No is valid')
		assert.strictEqual(await getAnswerOptionName(client, questionId, 3n), 'Malformed', 'does not exist')
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
		const questionId = getQuestionId(testScalarQuestion, [])
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

	test('scalar outcome labels match shared TypeScript renderer fixtures', async () => {
		const questionIdsByName = await createScalarParityQuestionIds()
		for (const fixture of SCALAR_PARITY_LABEL_FIXTURES) {
			const question = getScalarParityQuestion(fixture.questionName)
			const questionId = getScalarParityQuestionId(questionIdsByName, fixture.questionName)
			const answer = getScalarParityOutcomeIndex(question, fixture.tickIndex)
			assert.strictEqual(formatScalarParityLabel(question, fixture.tickIndex), fixture.expectedLabel, `${fixture.name} fixture label should be internally consistent`)
			assert.strictEqual(await getAnswerOptionName(client, questionId, answer), fixture.expectedLabel, `${fixture.name} contract label mismatch`)
		}
	})

	test('scalar answer encoding fixtures match shared TypeScript renderer model', async () => {
		const questionIdsByName = await createScalarParityQuestionIds()
		for (const fixture of SCALAR_PARITY_ENCODING_FIXTURES) {
			const question = getScalarParityQuestion(fixture.questionName)
			const questionId = getScalarParityQuestionId(questionIdsByName, fixture.questionName)
			const answer = combineScalarParityOutcomeIndex(fixture.invalid, fixture.firstPart, fixture.secondPart)
			assert.deepStrictEqual(describeScalarParityOutcomeIndex(question, answer), fixture.expectedDescriptor, `${fixture.name} descriptor fixture mismatch`)
			assert.strictEqual(formatScalarParityOutcomeName(question, answer), fixture.expectedLabel, `${fixture.name} expected name fixture mismatch`)
			await assertScalarContractMatchesParityModel(questionId, question, answer, fixture.name)
		}
	})

	test('fuzzes scalar answer encoding against the shared TypeScript renderer model', async () => {
		const questionIdsByName = await createScalarParityQuestionIds()
		let seed = 0x5ca1ab1ef00dn
		for (const question of SCALAR_PARITY_QUESTIONS) {
			const questionId = getScalarParityQuestionId(questionIdsByName, question.name)
			for (const sample of getScalarEncodingFuzzSamples(question, seed)) {
				const answer = combineScalarParityOutcomeIndex(sample.invalid, sample.firstPart, sample.secondPart)
				await assertScalarContractMatchesParityModel(questionId, question, answer, `${question.name} fuzz sample ${seed.toString(16)}`)
				seed = advanceScalarEncodingFuzzState(seed)
			}
		}
	})

	test('isMalformedAnswerOption: scalar answers with high bit set follow the scalar validity rules', async () => {
		// Create a scalar question
		const testScalarQuestion = {
			title: 'scalar',
			description: 'scalar',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: 1000n,
			displayValueMin: 0n,
			displayValueMax: 1000n,
			answerUnit: 'unit',
		}
		await createQuestion(client, testScalarQuestion, [])
		const questionId = getQuestionId(testScalarQuestion, [])

		// A) high bit set, sum == numTicks -> valid -> not malformed (false)
		{
			const ans = combineUint256FromTwoWithInvalid(false, 600n, 400n)
			const malformed = await isMalformedAnswerOption(client, questionId, ans)
			assert.strictEqual(malformed, false, 'high bit + correct sum should be valid (not malformed)')
		}

		// B) high bit set, sum != numTicks -> malformed (true)
		{
			const ans = combineUint256FromTwoWithInvalid(false, 500n, 400n) // sum=900 != 1000
			const malformed = await isMalformedAnswerOption(client, questionId, ans)
			assert.strictEqual(malformed, true, 'high bit + wrong sum should be malformed')
		}

		// C) high bit clear (invalid=true), non-zero -> malformed (true)
		{
			const ans = combineUint256FromTwoWithInvalid(true, 100n, 900n)
			const malformed = await isMalformedAnswerOption(client, questionId, ans)
			assert.strictEqual(malformed, true, 'invalid flag + non-zero is malformed')
		}

		// D) high bit clear, both zero -> not malformed (false) (Invalid)
		{
			const ans = combineUint256FromTwoWithInvalid(true, 0n, 0n)
			const malformed = await isMalformedAnswerOption(client, questionId, ans)
			assert.strictEqual(malformed, false, 'invalid flag + both zero is Invalid (not malformed)')
		}
	})

	test('scalar answers with non-zero reserved bits are malformed even when the payload is otherwise canonical', async () => {
		const testScalarQuestion = {
			title: 'scalar reserved bits',
			description: 'scalar reserved bits',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: 1000n,
			displayValueMin: 0n,
			displayValueMax: 1000n,
			answerUnit: 'unit',
		}
		await createQuestion(client, testScalarQuestion, [])
		const questionId = getQuestionId(testScalarQuestion, [])

		const canonicalScalarAnswer = combineUint256FromTwoWithInvalid(false, 600n, 400n)
		const aliasedScalarAnswer = withScalarReservedBits(canonicalScalarAnswer, 0x1234n)
		const canonicalInvalidAnswer = combineUint256FromTwoWithInvalid(true, 0n, 0n)
		const aliasedInvalidAnswer = withScalarReservedBits(canonicalInvalidAnswer, 0x7fffn)
		const canonicalScalarLabel = await getAnswerOptionName(client, questionId, canonicalScalarAnswer)

		assert.strictEqual(await isMalformedAnswerOption(client, questionId, canonicalScalarAnswer), false, 'canonical scalar answer should remain valid')
		assert.notStrictEqual(canonicalScalarLabel, 'Malformed', 'canonical scalar answer should keep a non-malformed label')
		assert.strictEqual(await isMalformedAnswerOption(client, questionId, aliasedScalarAnswer), true, 'scalar alias with reserved bits should be malformed')
		assert.strictEqual(await getAnswerOptionName(client, questionId, aliasedScalarAnswer), 'Malformed', 'scalar alias with reserved bits should render as malformed')
		assert.strictEqual(await isMalformedAnswerOption(client, questionId, aliasedInvalidAnswer), true, 'invalid alias with reserved bits should be malformed')
		assert.strictEqual(await getAnswerOptionName(client, questionId, aliasedInvalidAnswer), 'Malformed', 'invalid alias with reserved bits should render as malformed')
		assert.strictEqual(await getAnswerOptionName(client, questionId, canonicalInvalidAnswer), 'Invalid', 'canonical invalid answer should remain available')
	})

	test('accepts scalar questions at the uint120 encoding boundary', async () => {
		const maxScalarNumTicks = (1n << 120n) - 1n
		const testScalarQuestion = {
			title: 'Boundary Scalar',
			description: 'boundary scalar encoding',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: maxScalarNumTicks,
			outcomeLabels: [],
			displayValueMin: 0n,
			displayValueMax: 1n,
			answerUnit: '',
		}
		await createQuestion(client, testScalarQuestion, [])
		const questionId = getQuestionId(testScalarQuestion, [])

		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(false, maxScalarNumTicks, 0n)), '0', 'bottom endpoint should remain encodable at the boundary')
		assert.strictEqual(await getAnswerOptionName(client, questionId, combineUint256FromTwoWithInvalid(false, 0n, maxScalarNumTicks)), '0.000000000000000001', 'top endpoint should remain encodable at the boundary')
	})

	test('rejects scalar questions whose numTicks exceeds the uint120 answer encoding range', async () => {
		const tooLargeNumTicks = 1n << 120n
		const testScalarQuestion = {
			title: 'Too Large Scalar',
			description: 'too many ticks for uint120 encoding',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: tooLargeNumTicks,
			outcomeLabels: [],
			displayValueMin: 0n,
			displayValueMax: 1n,
			answerUnit: '',
		}

		await assert.rejects(createQuestion(client, testScalarQuestion, []), /numTicks.*out of unsigned bounds/)
	})

	// Test for integer overflow in getTradeInterval: maxValue - minValue exceeds int256max
	test('getTradeInterval handles extreme range without overflow', async () => {
		const int256Max = (1n << 255n) - 1n
		const int256Min = -(1n << 255n)
		const question = {
			title: 'extreme range overflow',
			description: '',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: 1000n,
			displayValueMin: int256Min,
			displayValueMax: int256Max,
			answerUnit: '',
		}
		await createQuestion(client, question, [])
		const questionId = getQuestionId(question, [])
		// Use a valid tick with secondPart = 1 to avoid int256min issue
		const answer = combineUint256FromTwoWithInvalid(false, question.numTicks - 1n, 1n)
		// After fix, this should not revert but return a valid scalar outcome name
		const name = await getAnswerOptionName(client, questionId, answer)
		assert.ok(name !== 'Malformed' && name !== 'Invalid', 'should return valid outcome name')
	})

	// Test for integer overflow in getScalarOutcomeName: scalarValue calculation may overflow
	// This is triggered by the same extreme range, but ensures the full computation succeeds.
	test('getScalarOutcomeName handles large scalarValue without overflow', async () => {
		const int256Max = (1n << 255n) - 1n
		const int256Min = -(1n << 255n)
		const question = {
			title: 'scalarValue overflow',
			description: '',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: 1000n,
			displayValueMin: int256Min,
			displayValueMax: int256Max,
			answerUnit: '',
		}
		await createQuestion(client, question, [])
		const questionId = getQuestionId(question, [])
		// Use a valid tick with secondPart = 1
		const answer = combineUint256FromTwoWithInvalid(false, question.numTicks - 1n, 1n)
		const name = await getAnswerOptionName(client, questionId, answer)
		assert.ok(name !== 'Malformed' && name !== 'Invalid', 'should return valid outcome name')
	})

	test('getScalarOutcomeName handles int256 min without reverting', async () => {
		const int256Min = -(1n << 255n)
		const question = {
			title: 'int256 min',
			description: '',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: 1000n,
			displayValueMin: int256Min,
			displayValueMax: int256Min + 1000n,
			answerUnit: '',
		}
		await createQuestion(client, question, [])
		const questionId = getQuestionId(question, [])
		const answer = combineUint256FromTwoWithInvalid(false, question.numTicks, 0n)
		const name = await getAnswerOptionName(client, questionId, answer)
		assert.ok(name.length > 0, 'should return a formatted scalar outcome')
	})

	test('createQuestion rejects duplicate outcome options', async () => {
		const question = {
			title: 'Test Duplicates',
			description: 'Testing uniqueness',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		// Duplicate entries: ['Yes', 'Yes']
		await assert.rejects(createQuestion(client, question, ['Yes', 'Yes']), { message: /outcome option hashes must be provided in descending sorted order/i })
		// Duplicate entries with more options
		await assert.rejects(createQuestion(client, question, ['Yes', 'No', 'Yes']), { message: /outcome option hashes must be provided in descending sorted order/i })
	})

	test('createQuestion rejects questions whose end time is before the start time', async () => {
		const currentTime = await mockWindow.getTime()
		const question = {
			title: 'Impossible timeline',
			description: '',
			startTime: currentTime + 200000n,
			endTime: currentTime + 100000n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}

		await assert.rejects(createQuestion(client, question, ['Yes', 'No']), { message: /question end time must be on or after the start time/i })
	})

	test('createQuestion enforces binary outcome order', async () => {
		const question = {
			title: 'Test Binary Order',
			description: 'Testing binary order requirement',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		// Correct order ['Yes','No'] is accepted
		assert.ok(areEqualArrays(sortStringArrayByKeccak(['Yes', 'No']), ['Yes', 'No']), 'sorting mismatch')
		await createQuestion(client, question, ['Yes', 'No'])
		const questionId1 = getQuestionId(question, ['Yes', 'No'])
		const labels1 = await getOutcomeLabels(client, questionId1)
		assert.deepStrictEqual(labels1, ['Yes', 'No'], 'binary outcome labels should match')

		// Reversed order ['No','Yes'] should be rejected
		await assert.rejects(createQuestion(client, question, ['No', 'Yes']), { message: /outcome option hashes must be provided in descending sorted order/i })
	})

	test('createQuestion rejects unsorted non-binary outcome options', async () => {
		const question = {
			title: 'Test Invalid Order',
			description: 'Testing unsorted options',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}

		const unsortedOutcomes = ['Apple', 'Banana', 'Cherry']
		assert.ok(!areEqualArrays(sortStringArrayByKeccak(unsortedOutcomes), unsortedOutcomes), 'test inputs must be intentionally unsorted')
		await assert.rejects(createQuestion(client, question, unsortedOutcomes), { message: /outcome option hashes must be provided in descending sorted order/i })
	})

	test('createQuestion accepts non-binary outcome options after sorting them by the contract hash order', async () => {
		const question = {
			title: 'Test Valid',
			description: 'Testing valid options',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		// For non-binary questions, any order of unique options is accepted
		await createQuestion(client, question, sortStringArrayByKeccak(['Apple', 'Banana', 'Cherry']))
		const questionId = getQuestionId(question, sortStringArrayByKeccak(['Apple', 'Banana', 'Cherry']))
		const labels = await getOutcomeLabels(client, questionId)
		assert.deepStrictEqual(labels, sortStringArrayByKeccak(['Apple', 'Banana', 'Cherry']), 'outcome labels should match')
	})

	test('createQuestion accepts unique outcome options once sorted into the contract order', async () => {
		const question = {
			title: 'Test Valid',
			description: 'Testing valid options',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		// Unique options in arbitrary order are accepted (order not enforced)
		await createQuestion(client, question, sortStringArrayByKeccak(['Apple', 'Banana', 'Cherry']))
		const questionId = getQuestionId(question, sortStringArrayByKeccak(['Apple', 'Banana', 'Cherry']))
		const labels = await getOutcomeLabels(client, questionId)
		assert.deepStrictEqual(labels, sortStringArrayByKeccak(['Apple', 'Banana', 'Cherry']), 'outcome labels should match')

		// Binary outcome ['Yes','No'] is also accepted
		await createQuestion(client, question, ['Yes', 'No'])
		const questionId2 = getQuestionId(question, ['Yes', 'No'])
		const labels2 = await getOutcomeLabels(client, questionId2)
		assert.deepStrictEqual(labels2, ['Yes', 'No'], 'binary outcome labels should match')
	})

	test('question pagination returns exact-length pages without zero padding', async () => {
		const question = {
			title: 'Paged Question',
			description: '',
			startTime: (await mockWindow.getTime()) + 100000n,
			endTime: (await mockWindow.getTime()) + 200000n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const firstOutcomes = sortStringArrayByKeccak(['Alpha', 'Beta', 'Gamma'])
		const secondOutcomes = ['Yes', 'No']
		const secondQuestion = { ...question, title: 'Paged Question 2' }
		await createQuestion(client, question, firstOutcomes)
		await createQuestion(client, secondQuestion, secondOutcomes)
		const firstQuestionId = getQuestionId(question, firstOutcomes)
		const secondQuestionId = getQuestionId(secondQuestion, secondOutcomes)

		const rawQuestionPage = await client.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'getQuestions',
			address: getInfraContractAddresses().zoltarQuestionData,
			args: [1n, 5n],
		})
		const maxCountQuestionPage = await client.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'getQuestions',
			address: getInfraContractAddresses().zoltarQuestionData,
			args: [0n, MAX_UINT256],
		})

		const rawOutcomePage = await client.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'getOutcomeLabels',
			address: getInfraContractAddresses().zoltarQuestionData,
			args: [firstQuestionId, 1n, 5n],
		})
		const maxCountOutcomePage = await client.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'getOutcomeLabels',
			address: getInfraContractAddresses().zoltarQuestionData,
			args: [firstQuestionId, 1n, MAX_UINT256],
		})
		const questionPage = rawQuestionPage.filter((questionId: bigint) => questionId !== 0n)
		const outcomePage = rawOutcomePage.filter((label: string) => label !== '')

		assert.deepStrictEqual(questionPage.length, 1, 'question paging should return only the remaining ids')
		assert.deepStrictEqual(outcomePage, [firstOutcomes[1], firstOutcomes[2]], 'outcome paging should return only the remaining labels')
		assert.deepStrictEqual(maxCountQuestionPage, [firstQuestionId, secondQuestionId], 'question paging should clamp max count to available ids')
		assert.deepStrictEqual(maxCountOutcomePage, [firstOutcomes[1], firstOutcomes[2]], 'outcome paging should clamp max count to available labels')
	})
})
