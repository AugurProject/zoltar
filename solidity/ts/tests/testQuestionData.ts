import { describe } from 'node:test'
import { getCreate2Address, keccak256, toHex } from 'viem'

export const getScalarTradingAddress = () => getCreate2Address({ bytecode: `0x${ scalar trading.evm.bytecode.object }`, from: addressString(PROXY_DEPLOYER_ADDRESS), salt: numberToBytes(0) })

export const applyLibraries = (bytecode: string): `0x${ string }` => {
	const scalarTrading = keccak256(toHex('contracts/ScalarTrading.sol:ScalarTrading')).slice(2, 36)
	const replaceLib = (bytecode: string, hash: string, replaceWithAddress: `0x${ string }`) => bytecode.replaceAll(`__$${ hash }$__`, replaceWithAddress.slice(2).toLocaleLowerCase())
	return `0x${ replaceLib(bytecode, scalarTrading, getScalarTradingAddress()) }`
}

export const getSecurityPoolForkerByteCode = (zoltar: `0x${ string }`) => {
	return encodeDeployDate({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		bytecode: applyLibraries(peripherals_SecurityPoolForker_SecurityPoolForker.evm.bytecode.object),
		args: [ zoltar ]
	})
}

describe('Question Data', () => {
	let mockWindow: MockWindowEthereum
	let client: WriteClient

	beforeEach(async () => {
		mockWindow = getMockedEthSimulateWindowEthereum()
		mockWindow.setAfterTransactionSendCallBack(createTransactionExplainer(getDeployments(genesisUniverse, marketId, securityMultiplier)))
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		//await mockWindow.setStartBLock(mockWindow.getTime)
		await setupTestAccounts(mockWindow)
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
