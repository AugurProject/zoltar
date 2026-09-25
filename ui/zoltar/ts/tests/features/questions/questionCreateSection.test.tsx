/// <reference types="bun-types" />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import { GlobalTransactionPresentationProvider } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { GlobalTransactionDialog } from '@zoltar/ui-core-shared/app/components/GlobalTransactionDialog.js'
import type { MarketCreationResult, MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { QuestionCreateSection } from '@zoltar/ui-zoltar-shared/features/questions/components/QuestionCreateSection.js'
import type { MarketFormState } from '@zoltar/ui-zoltar-shared/types/app.js'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'

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
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
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
		expect(documentQueries.getByRole('alert').textContent).toContain('Previous creation failed')
		expectTransactionButtonDisabled(document.body, 'Create question', 'Connect a wallet before creating a question.')
	})

	test('shows a failed question write only in the shared transaction dialog', async () => {
		const transaction = { detail: 'Action canceled in wallet.', dismissKey: 'transaction-request-question-write', title: 'Question creation', tone: 'error' as const }
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionPresentationProvider transaction={transaction}>
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
					questionError='Action canceled in wallet.'
					questionForm={createQuestionForm()}
					questionResult={undefined}
					zoltarQuestions={[]}
				/>
				<GlobalTransactionDialog transaction={transaction} />
			</GlobalTransactionPresentationProvider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const queries = within(document.body)
		const dialog = queries.getByRole('dialog', { name: 'Transaction status' })
		expect(within(dialog).getByText('Action canceled in wallet.')).not.toBeNull()
		expect(document.querySelector('form')?.textContent).not.toContain('Action canceled in wallet.')
		await act(() => fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' })))
		expect(queries.queryByRole('dialog', { name: 'Transaction status' })).toBeNull()
		expect(document.querySelector('form')?.textContent).not.toContain('Action canceled in wallet.')
	})

	test('renders the inline transaction review in place of the overridden submit button', async () => {
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
				questionResult={undefined}
				submitActionOverride={{ availability: { disabled: false, reason: undefined }, idleLabel: 'Create question and pool', onSubmit: () => undefined, pending: true, pendingLabel: 'Creating…', reviewContent: <div data-testid='inline-review'>Confirm the pool transaction</div> }}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Confirm the pool transaction')).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: /Create question and pool|Creating…/ })).toBeNull()
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
		expect(document.body.querySelector('.transaction-hash-link')).toBeNull()
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

	test('offers question types as a native radio group with descriptions and examples', async () => {
		const updates: Array<Partial<MarketFormState>> = []
		const renderedComponent = await renderIntoDocument(
			<QuestionCreateSection
				accountAddress={zeroAddress}
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
				questionError={undefined}
				questionForm={createQuestionForm()}
				questionResult={undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const group = document.querySelector('fieldset.question-type-options')
		if (!(group instanceof HTMLElement)) throw new Error('Expected the question type fieldset')
		expect(group.querySelector('legend')?.textContent).toBe('Question Type')
		const radios = within(group).getAllByRole('radio') as HTMLInputElement[]
		expect(radios.map(radio => radio.value)).toEqual(['binary', 'categorical', 'scalar'])
		expect(new Set(radios.map(radio => radio.name)).size).toBe(1)
		const binary = documentQueries.getByRole('radio', { name: 'Binary' }) as HTMLInputElement
		expect(binary.checked).toBe(true)
		const scalar = documentQueries.getByRole('radio', { name: 'Scalar' }) as HTMLInputElement
		expect(scalar.checked).toBe(false)
		const scalarDescription = (scalar.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent)
		expect(scalarDescription).toEqual(['A number inside a range, with a unit and increment.', 'e.g. What will the ETH price be on 31 Dec, in USD?'])
		await act(() => fireEvent.click(scalar))
		expect(updates).toContainEqual({ marketType: 'scalar' })
	})

	test('labels time inputs with the browser time zone and previews each time locally and in UTC', async () => {
		const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone
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
				questionForm={createQuestionForm({ endTime: '1798752600', startTime: '' })}
				questionResult={undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const endTimeInput = documentQueries.getByLabelText('End Time')
		const timeZoneHelp = document.getElementById(endTimeInput.getAttribute('aria-describedby') ?? '')
		expect(timeZoneHelp?.textContent).toMatch(/^Your time \(.+\)\. Blank start means immediately\.$/)
		if (timeZone !== 'UTC' && timeZone !== 'Etc/UTC') expect(timeZoneHelp?.textContent).toContain(timeZone)
		const preview = document.querySelector('aside[aria-label="Question preview"]')
		if (!(preview instanceof HTMLElement)) throw new Error('Expected the question preview landmark')
		const summary = within(preview).getByRole('list', { name: 'Draft question summary' })
		const [starts, ends] = within(summary).getAllByRole('listitem')
		expect(starts?.textContent).toContain('Immediately after creation')
		expect(ends?.querySelector('time')?.getAttribute('dateTime')).toBe('2026-12-31T21:30:00.000Z')
		expect(ends?.textContent).toContain('2026-12-31 21:30 UTC')
	})
})
