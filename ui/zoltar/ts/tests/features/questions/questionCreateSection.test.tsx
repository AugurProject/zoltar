/// <reference types="bun-types" />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import { GlobalTransactionPresentationProvider } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { GlobalTransactionDialog } from '@zoltar/ui-core-shared/app/components/GlobalTransactionDialog.js'
import type { MarketCreationResult, MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { ChainTimestampContext } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { QuestionCreateSection } from '@zoltar/ui-zoltar-shared/features/questions/components/QuestionCreateSection.js'
import { getDraftOutcomeLabels } from '@zoltar/ui-zoltar-shared/features/questions/lib/questionCreation.js'
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

type QuestionCreateSectionProps = Parameters<typeof QuestionCreateSection>[0]

function createSectionProps(overrides: Partial<QuestionCreateSectionProps> = {}): QuestionCreateSectionProps {
	return {
		accountAddress: zeroAddress,
		canUseForFork: false,
		hasForked: false,
		isOnActiveAppChain: true,
		loadingZoltarQuestions: false,
		onCreateQuestion: () => undefined,
		onOpenForkTab: () => undefined,
		onQuestionFormChange: () => undefined,
		onResetQuestion: () => undefined,
		onUseQuestionForFork: () => undefined,
		questionCreating: false,
		questionError: undefined,
		questionForm: createQuestionForm(),
		questionResult: undefined,
		zoltarQuestions: [],
		...overrides,
	}
}

describe('QuestionCreateSection', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	async function renderSection(overrides: Partial<QuestionCreateSectionProps> = {}, chainTimestamp?: bigint) {
		const section = <QuestionCreateSection {...createSectionProps(overrides)} />
		const rendered = await renderIntoDocument(chainTimestamp === undefined ? section : <ChainTimestampContext.Provider value={chainTimestamp}>{section}</ChainTimestampContext.Provider>)
		cleanupRenderedComponent = rendered.cleanup
		return rendered
	}

	test('blocks review without a wallet and reports field updates', async () => {
		const updates: Array<Partial<MarketFormState>> = []
		await renderSection({ accountAddress: undefined, onQuestionFormChange: update => updates.push(update), questionError: 'Previous creation failed' })

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
		const transaction = { detail: 'Canceled in wallet.', dismissKey: 'transaction-request-question-write', title: 'Question creation', tone: 'error' as const }
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionPresentationProvider transaction={transaction}>
				<QuestionCreateSection {...createSectionProps({ questionError: 'Canceled in wallet.' })} />
				<GlobalTransactionDialog transaction={transaction} />
			</GlobalTransactionPresentationProvider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const queries = within(document.body)
		const dialog = queries.getByRole('region', { name: 'Transaction status' })
		expect(within(dialog).getByText('Canceled in wallet.')).not.toBeNull()
		expect(document.querySelector('form')?.textContent).not.toContain('Canceled in wallet.')
		await act(() => fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' })))
		expect(queries.queryByRole('region', { name: 'Transaction status' })).toBeNull()
		expect(document.querySelector('form')?.textContent).not.toContain('Canceled in wallet.')
	})

	test('renders the inline transaction review in place of the overridden submit button', async () => {
		await renderSection({ submitActionOverride: { availability: { disabled: false, reason: undefined }, idleLabel: 'Create question and pool', onSubmit: () => undefined, pending: true, pendingLabel: 'Creating…', reviewContent: <div data-testid='inline-review'>Confirm the pool transaction</div> } })

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
		const handoffProps = {
			canUseForFork: true,
			onOpenForkTab: () => openedViews.push('fork'),
			onResetQuestion: () => {
				resetCount += 1
			},
			onUseQuestionForFork: (questionId: string) => selectedQuestionIds.push(questionId),
		}
		const renderedComponent = await renderSection({
			...handoffProps,
			onCreateQuestion: () => {
				createCount += 1
			},
		})
		const documentQueries = within(document.body)

		await act(() => fireEvent.click(documentQueries.getByRole('button', { name: 'Create question' })))
		expect(createCount).toBe(1)

		await renderedComponent.cleanup()
		cleanupRenderedComponent = undefined
		await renderSection({ ...handoffProps, questionResult: result, zoltarQuestions: [question] }, question.endTime)
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

	test('keeps the post-create fork handoff in place, disabled with a reason, until the question ends or the universe loads', async () => {
		const result: MarketCreationResult = { createQuestionHash: `0x${'1'.repeat(64)}`, marketType: 'binary', questionId: question.questionId }
		const selectedQuestionIds: string[] = []
		const useForForkName = `Use for fork: ${question.title} (${question.questionId})`
		const rendered = await renderSection({ canUseForFork: true, onUseQuestionForFork: questionId => selectedQuestionIds.push(questionId), questionResult: result, zoltarQuestions: [question] }, question.endTime - 1n)
		const useForFork = within(document.body).getByRole('button', { name: useForForkName })
		expect(useForFork.hasAttribute('disabled')).toBe(true)
		expect(document.getElementById(useForFork.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Only an ended question can fork a universe.')
		fireEvent.click(useForFork)
		expect(selectedQuestionIds).toEqual([])
		await rendered.cleanup()
		cleanupRenderedComponent = undefined

		await renderSection({ canUseForFork: true, forkUnavailableReason: 'Universe details could not be loaded.', questionResult: result, zoltarQuestions: [question] }, question.endTime)
		const blockedByUniverse = within(document.body).getByRole('button', { name: useForForkName })
		expect(blockedByUniverse.hasAttribute('disabled')).toBe(true)
		expect(document.getElementById(blockedByUniverse.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Universe details could not be loaded.')
	})

	test('blocks Create for a question that already exists and offers the existing question instead', async () => {
		const selectedQuestionIds: string[] = []
		const openedViews: string[] = []
		await renderSection({ canUseForFork: true, existingQuestionCheck: { question, status: 'existing' }, onOpenForkTab: () => openedViews.push('fork'), onUseQuestionForFork: questionId => selectedQuestionIds.push(questionId) }, question.endTime)

		expectTransactionButtonDisabled(document.body, 'Create question', 'This question already exists.')
		const existing = within(document.body).getByText('Existing question').closest('details')
		if (!(existing instanceof HTMLElement)) throw new Error('Expected the existing question disclosure')
		expect(existing.textContent).toContain(question.title)
		await act(() => fireEvent.click(within(existing).getByRole('button', { name: `Use for fork: ${question.title} (${question.questionId})` })))
		expect(selectedQuestionIds).toEqual([question.questionId])
		expect(openedViews).toEqual(['fork'])
	})

	test('waits for the existing-question lookup before enabling Create', async () => {
		await renderSection({ existingQuestionCheck: { status: 'checking' } })
		expectTransactionButtonDisabled(document.body, 'Create question', 'Checking for an existing question…')
		expect(within(document.body).queryByText('Existing question')).toBeNull()
	})

	test('locks the draft while its question is being created', async () => {
		await renderSection({ questionCreating: true })
		expect(document.querySelector<HTMLFieldSetElement>('fieldset.question-create-editor')?.disabled).toBe(true)
	})

	test('orders scalar fields as the range first, then its increment and unit', async () => {
		await renderSection({ questionForm: createQuestionForm({ marketType: 'scalar' }) })
		const editor = document.querySelector('fieldset.question-create-editor')
		if (editor === null) throw new Error('Expected the question editor')
		const labels = [...editor.querySelectorAll('.field-row')].map(row => [...row.querySelectorAll('input')].map(input => input.getAttribute('aria-label') ?? input.getAttribute('placeholder')))
		expect(labels.slice(-2)).toEqual([
			['Scalar min', 'Scalar max'],
			['Scalar increment', 'USD'],
		])
	})

	test('omits the post-create fork handoff when no universe is available', async () => {
		const result: MarketCreationResult = { createQuestionHash: `0x${'1'.repeat(64)}`, marketType: 'binary', questionId: question.questionId }
		await renderSection({ questionResult: result, zoltarQuestions: [question] })

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: `Use for fork: ${question.title} (${question.questionId})` })).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Create another question' })).toBeDefined()
	})

	test('offers question types as a native radio group with descriptions and examples', async () => {
		const updates: Array<Partial<MarketFormState>> = []
		await renderSection({ onQuestionFormChange: update => updates.push(update) })

		const documentQueries = within(document.body)
		const group = document.querySelector('fieldset.question-type-options')
		if (!(group instanceof HTMLElement)) throw new Error('Expected the question type fieldset')
		expect(group.querySelector('legend')?.textContent).toBe('Question type')
		const radios = within(group).getAllByRole('radio') as HTMLInputElement[]
		expect(radios.map(radio => radio.value)).toEqual(['binary', 'categorical', 'scalar'])
		expect(new Set(radios.map(radio => radio.name)).size).toBe(1)
		const binary = documentQueries.getByRole('radio', { name: 'Binary' }) as HTMLInputElement
		expect(binary.checked).toBe(true)
		const scalar = documentQueries.getByRole('radio', { name: 'Scalar' }) as HTMLInputElement
		expect(scalar.checked).toBe(false)
		const scalarDescription = (scalar.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent)
		expect(scalarDescription).toEqual(['A number inside a range, with a unit and increment.', 'e.g. What will the ETH price be on 31 Dec, in USD?'])
		// The radio names and describes its card, so the visible card text is hidden from browse mode instead of being read a second time.
		for (const radio of radios) expect(radio.closest('label')?.querySelector('.question-type-option-copy')?.getAttribute('aria-hidden')).toBe('true')
		await act(() => fireEvent.click(scalar))
		expect(updates).toContainEqual({ marketType: 'scalar' })
	})

	test('previews categorical outcomes in the order they were typed, not the onchain order', () => {
		expect(getDraftOutcomeLabels(createQuestionForm({ marketType: 'categorical', categoricalOutcomes: ['Cherry', ' Apple ', 'Banana'] }))).toEqual(['Cherry', 'Apple', 'Banana', 'Invalid'])
	})

	test('previews missing categorical outcomes without a placeholder chip', () => {
		expect(getDraftOutcomeLabels(createQuestionForm({ marketType: 'categorical', categoricalOutcomes: ['', ''] }))).toEqual(['Invalid'])
		expect(getDraftOutcomeLabels(createQuestionForm({ marketType: 'categorical', categoricalOutcomes: ['Alpha', ''] }))).toEqual(['Alpha', 'Invalid'])
	})

	test('explains the disabled remove buttons at the two-outcome minimum without asking for more outcomes', async () => {
		await renderSection({ questionForm: createQuestionForm({ marketType: 'categorical', categoricalOutcomes: ['Yes', 'No'] }) })

		const reason = document.getElementById('minimum-outcomes-reason')
		expect(reason?.textContent).toBe('Remove is unavailable: keep at least 2 outcomes.')
		expect(reason?.classList.contains('field-hint')).toBe(true)
		expect(within(document.body).getByRole('button', { name: 'Remove outcome 1' }).getAttribute('aria-describedby')).toBe('minimum-outcomes-reason')
	})

	test('keeps the remove reason after a real outcome error so it never reads as the error', async () => {
		await renderSection({ questionForm: createQuestionForm({ marketType: 'categorical', categoricalOutcomes: ['Yes', 'Yes'] }) })

		await act(() => within(document.body).getByPlaceholderText('Outcome 1').dispatchEvent(new Event('blur')))
		const error = document.getElementById('market-create-outcomes-error')
		const reason = document.getElementById('minimum-outcomes-reason')
		if (error === null || reason === null) throw new Error('Expected the outcome error and the remove reason')
		expect(error.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		expect(reason.classList.contains('field-error')).toBe(false)
	})

	test('labels time inputs with the browser time zone and previews each time locally and in UTC', async () => {
		const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone
		await renderSection({ questionForm: createQuestionForm({ endTime: '1798752600', startTime: '' }) })

		const documentQueries = within(document.body)
		const endTimeInput = documentQueries.getByLabelText('End time')
		const timeZoneHelp = document.getElementById(endTimeInput.getAttribute('aria-describedby') ?? '')
		expect(timeZoneHelp?.textContent).toMatch(/^Times use your time zone \(.+\)\. Leave start time blank to start immediately\.$/)
		if (timeZone !== 'UTC' && timeZone !== 'Etc/UTC') expect(timeZoneHelp?.textContent).toContain(timeZone)
		const preview = document.querySelector('aside[aria-label="Draft preview"]')
		if (!(preview instanceof HTMLElement)) throw new Error('Expected the question preview landmark')
		const summary = within(preview).getByRole('list', { name: 'Question timeline' })
		const [starts, ends] = within(summary).getAllByRole('listitem')
		expect(starts?.textContent).toContain('Immediately after creation')
		expect(ends?.querySelector('time')?.getAttribute('dateTime')).toBe('2026-12-31T21:30:00.000Z')
		expect(ends?.textContent).toContain('2026-12-31 21:30 UTC')
	})

	test('keeps extra submit fields with the inputs, before the preview, and states a single allowed type without an example', async () => {
		await renderSection({ allowedMarketTypes: ['binary'], submitFields: <input aria-label='Pool multiplier' /> })

		const extraField = within(document.body).getByLabelText('Pool multiplier')
		const preview = document.querySelector('aside[aria-label="Draft preview"]')
		const submitButton = within(document.body).getByRole('button', { name: 'Create question' })
		if (preview === null) throw new Error('Expected the question preview landmark')
		expect(extraField.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		expect(preview.compareDocumentPosition(submitButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		expect(document.querySelectorAll('input[name="market-create-type"]')).toHaveLength(0)
		const fixedType = document.querySelector('.question-type-fixed')
		expect(fixedType?.textContent).toContain('Binary')
		expect(fixedType?.textContent).not.toContain('e.g.')
	})
})
