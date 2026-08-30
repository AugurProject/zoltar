/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import { QuestionCreateSection } from '../../../features/questions/components/QuestionCreateSection.js'
import type { MarketFormState } from '../../../types/app.js'
import type { MarketCreationResult, MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'

function createQuestionForm(overrides: Partial<MarketFormState> = {}): MarketFormState {
	return {
		answerUnit: '',
		categoricalOutcomes: ['Yes', 'No'],
		description: 'Question context',
		endTime: '2000',
		marketType: 'binary',
		scalarIncrement: '0.1',
		scalarMax: '10',
		scalarMin: '0',
		startTime: '1000',
		title: 'Will this happen?',
		...overrides,
	}
}

const question: MarketDetails = {
	answerUnit: '',
	createdAt: 1n,
	description: 'Question description',
	displayValueMax: 2n,
	displayValueMin: 0n,
	endTime: 2000n,
	exists: true,
	marketType: 'binary',
	numTicks: 2n,
	outcomeLabels: ['Yes', 'No'],
	questionId: '0xquestion-1',
	startTime: 1000n,
	title: 'Binary question',
}

describe('QuestionCreateSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('blocks review without a wallet and reports field updates', async () => {
		const updates: Array<Partial<MarketFormState>> = []
		const renderedComponent = await renderIntoDocument(
			<QuestionCreateSection
				accountAddress={undefined}
				canUseForFork={false}
				hasForked={false}
				isOnActiveAppChain={true}
				loadingZoltarQuestions={false}
				onCreateQuestion={() => undefined}
				onOpenForkTab={() => undefined}
				onQuestionFormChange={update => updates.push(update)}
				onResetQuestion={() => undefined}
				onUseQuestionForFork={() => undefined}
				questionCreating={false}
				questionError='Previous creation failed'
				questionForm={createQuestionForm()}
				questionResult={undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.input(documentQueries.getByLabelText('Title') as HTMLInputElement, { target: { value: 'Updated question' } })
		})
		expect(updates).toContainEqual({ title: 'Updated question' })
		expect(documentQueries.getByText('Previous creation failed')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Review question', 'Connect a wallet before creating a question.')
	})

	test('reviews, submits, and offers only the Zoltar fork handoff after success', async () => {
		let createCount = 0
		let resetCount = 0
		const selectedQuestionIds: string[] = []
		const openedViews: string[] = []
		const result: MarketCreationResult = { createQuestionHash: `0x${'1'.repeat(64)}`, marketType: 'binary', questionId: question.questionId }
		const renderedComponent = await renderIntoDocument(
			<QuestionCreateSection
				accountAddress={zeroAddress}
				canUseForFork={true}
				hasForked={false}
				isOnActiveAppChain={true}
				loadingZoltarQuestions={false}
				onCreateQuestion={() => {
					createCount += 1
				}}
				onOpenForkTab={() => openedViews.push('fork')}
				onQuestionFormChange={() => undefined}
				onResetQuestion={() => {
					resetCount += 1
				}}
				onUseQuestionForFork={questionId => selectedQuestionIds.push(questionId)}
				questionCreating={false}
				questionError={undefined}
				questionForm={createQuestionForm()}
				questionResult={undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		await act(() => fireEvent.click(documentQueries.getByRole('button', { name: 'Review question' })))
		await act(() => fireEvent.click(documentQueries.getByRole('button', { name: 'Create question' })))
		expect(createCount).toBe(1)

		await renderedComponent.cleanup()
		cleanupRenderedComponent = undefined
		const successComponent = await renderIntoDocument(
			<QuestionCreateSection
				accountAddress={zeroAddress}
				canUseForFork={true}
				hasForked={false}
				isOnActiveAppChain={true}
				loadingZoltarQuestions={false}
				onCreateQuestion={() => undefined}
				onOpenForkTab={() => openedViews.push('fork')}
				onQuestionFormChange={() => undefined}
				onResetQuestion={() => {
					resetCount += 1
				}}
				onUseQuestionForFork={questionId => selectedQuestionIds.push(questionId)}
				questionCreating={false}
				questionError={undefined}
				questionForm={createQuestionForm()}
				questionResult={result}
				zoltarQuestions={[question]}
			/>,
		)
		cleanupRenderedComponent = successComponent.cleanup
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: `Use for fork: ${question.title} (${question.questionId})` }))
			fireEvent.click(within(document.body).getByRole('button', { name: 'Create another question' }))
		})
		expect(selectedQuestionIds).toEqual([question.questionId])
		expect(openedViews).toEqual(['fork'])
		expect(resetCount).toBe(1)
		expect(document.body.textContent).not.toContain('Security Pool')
	})

	test('omits the post-create fork handoff when no universe is available', async () => {
		const result: MarketCreationResult = { createQuestionHash: `0x${'1'.repeat(64)}`, marketType: 'binary', questionId: question.questionId }
		const renderedComponent = await renderIntoDocument(
			<QuestionCreateSection
				accountAddress={zeroAddress}
				canUseForFork={false}
				hasForked={false}
				isOnActiveAppChain={true}
				loadingZoltarQuestions={false}
				onCreateQuestion={() => undefined}
				onOpenForkTab={() => undefined}
				onQuestionFormChange={() => undefined}
				onResetQuestion={() => undefined}
				onUseQuestionForFork={() => undefined}
				questionCreating={false}
				questionError={undefined}
				questionForm={createQuestionForm()}
				questionResult={result}
				zoltarQuestions={[question]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: `Use for fork: ${question.title} (${question.questionId})` })).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Create another question' })).toBeDefined()
	})
})
