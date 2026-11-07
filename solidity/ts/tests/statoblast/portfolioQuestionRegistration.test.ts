import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { sortStringArrayByKeccak } from '../../testSupport/simulator/utils/utilities'
import { useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: portfolio canonical question registration', () => {
	const fixture = useSecurityPoolPortfolioFixture()

	test.each([0n, 1n])('rejects registration at question end plus %s seconds', async offset => {
		const question = { ...fixture.base.questionData, title: `Ended registration ${offset}` }
		await createQuestion(fixture.owner(), question, fixture.base.outcomes)
		await fixture.base.mockWindow.setTime(question.endTime + offset)
		await expect(fixture.register(getQuestionId(question, fixture.base.outcomes))).rejects.toThrow()
	})

	test.each([
		{ labels: ['Apple', 'Banana', 'Cherry'], error: 'Question must have two outcomes' },
		{ labels: ['Apple', 'Banana'], error: 'First outcome must be Yes' },
		{ labels: ['Yes', 'Apple'], error: 'Second outcome must be No' },
	])('rejects noncanonical labels $labels', async ({ labels, error }) => {
		const outcomes = sortStringArrayByKeccak(labels)
		const question = { ...fixture.base.questionData, title: `Noncanonical ${labels.join('/')}` }
		await createQuestion(fixture.owner(), question, outcomes)
		await expect(fixture.register(getQuestionId(question, outcomes))).rejects.toThrow(error)
	})

	test('rejects scalar questions and nonexistent question IDs', async () => {
		const scalar = { ...fixture.base.questionData, title: 'Scalar registration', numTicks: 100n, displayValueMax: 100n, answerUnit: 'dollars' }
		await createQuestion(fixture.owner(), scalar, [])
		await expect(fixture.register(getQuestionId(scalar, []))).rejects.toThrow('Question must have two outcomes')
		await expect(fixture.register(999999999999n)).rejects.toThrow('Question does not exist')
	})
})
