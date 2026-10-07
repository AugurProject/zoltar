import { createMarketDetails as marketDetailsFixture } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
/// <reference types="bun-types" />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import type { MarketCreationResult, MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { ChainTimestampContext } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { MarketCreateQuestionSection } from '@zoltar/ui-statoblast-shared/features/markets/components/MarketCreateQuestionSection.js'
import { createMarketParameters } from '@zoltar/ui-statoblast-shared/features/markets/lib/marketCreation.js'
import type { MarketFormState } from '@zoltar/ui-zoltar-shared/types/app.js'
import { describe, expect, test } from 'bun:test'
import type { ComponentProps } from 'preact'
import { act } from 'preact/test-utils'

type MarketCreateQuestionSectionProps = ComponentProps<typeof MarketCreateQuestionSection>

function createMarketForm(overrides: Partial<MarketFormState> = {}): MarketFormState {
	return {
		answerUnit: '',
		categoricalOutcomes: ['Yes', 'No'],
		description: 'Question context',
		endTime: '2000',
		marketType: 'binary',
		scalarIncrement: '0.1',
		scalarMax: '10',
		scalarMin: '0',
		title: 'Will this happen?',
		startTime: '1000',
		...overrides,
	}
}

function createMarketDetails(overrides: Partial<MarketDetails> = {}): MarketDetails {
	return marketDetailsFixture({
		displayValueMax: 10n,
		endTime: 2000n,
		numTicks: 10n,
		questionId: '0xquestion-1',
		startTime: 1000n,
		title: 'Binary question',
		...overrides,
	})
}

function createSectionProps(overrides: Partial<MarketCreateQuestionSectionProps>): MarketCreateQuestionSectionProps {
	return {
		accountAddress: zeroAddress,
		hasForked: false,
		isOnActiveAppChain: true,
		marketCreating: false,
		marketError: undefined,
		marketForm: createMarketForm(),
		marketResult: undefined,
		loadingZoltarQuestions: false,
		onCreateMarket: () => {
			throw new Error('create should remain unavailable')
		},
		onMarketFormChange: () => undefined,
		onOpenForkTab: () => undefined,
		onResetMarket: () => undefined,
		onUseQuestionForFork: () => undefined,
		zoltarQuestions: [],
		...overrides,
	}
}

function getDraftPreview() {
	const draftPreview = within(document.body).getByRole('heading', { name: 'Draft preview' }).closest('section')
	if (!(draftPreview instanceof HTMLElement)) throw new Error('Expected draft preview section')
	return draftPreview
}

function getDraftPreviewOutcomeChips() {
	return Array.from(getDraftPreview().querySelectorAll('.outcome-chip'))
}

function getDraftPreviewOutcomeLabels() {
	return getDraftPreviewOutcomeChips().map(element => element.textContent?.trim() ?? '')
}

function getDescribedText(element: Element) {
	return document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent
}

describe('MarketCreateQuestionSection', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let marketForm = createMarketForm()

	installDomTestLifecycle({
		beforeTest: () => {
			marketForm = createMarketForm()
		},
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	async function renderSection(overrides: Partial<MarketCreateQuestionSectionProps> = {}, chainTimestamp?: bigint) {
		const section = <MarketCreateQuestionSection {...createSectionProps(overrides)} />
		const renderedComponent = await renderIntoDocument(chainTimestamp === undefined ? section : <ChainTimestampContext.Provider value={chainTimestamp}>{section}</ChainTimestampContext.Provider>)
		cleanupRenderedComponent = renderedComponent.cleanup
		return renderedComponent
	}

	test('collects form updates and blocks create without wallet', async () => {
		const updates: Array<Partial<MarketFormState>> = []
		await renderSection({
			accountAddress: undefined,
			isOnActiveAppChain: false,
			marketForm,
			onMarketFormChange: update => {
				marketForm = { ...marketForm, ...update }
				updates.push(update)
			},
		})

		const documentQueries = within(document.body)
		expect(document.querySelectorAll('input[name="market-create-type"]')).toHaveLength(0)
		expect(document.querySelector('.question-type-fixed')?.textContent).toContain('Binary')
		await act(() => {
			fireEvent.input(documentQueries.getByLabelText('Title') as HTMLInputElement, { target: { value: 'Updated title' } })
		})
		await act(() => {
			fireEvent.input(documentQueries.getByLabelText('Start time') as HTMLInputElement, { target: { value: '1200' } })
		})
		expectTransactionButtonDisabled(document.body, 'Create question', 'Connect a wallet before creating a question.')
		expect(updates.length).toBeGreaterThan(0)
		expect(updates.some(update => update.title === 'Updated title')).toBe(true)
	})

	test('shows neutral guidance until an invalid field is touched', async () => {
		await renderSection({ marketForm: createMarketForm({ description: '', title: '' }) })

		const documentQueries = within(document.body)
		const titleInput = documentQueries.getByLabelText('Title') as HTMLInputElement
		expect(titleInput.required).toBe(true)
		expect((documentQueries.getByLabelText('End time') as HTMLInputElement).required).toBe(true)
		expect(documentQueries.queryByText('Required fields are marked with an asterisk (*).')).toBeNull()
		expect(documentQueries.getByText(/^Times use your time zone \(.+\)\. Leave start time blank to start immediately\.$/)).not.toBeNull()
		expect(documentQueries.queryByText('Use a short question that clearly distinguishes the possible outcomes.')).toBeNull()
		expect(document.body.querySelector('.workflow-summary-strip')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Question type Guidance' })).toBeNull()
		expect(document.querySelectorAll('input[name="market-create-type"]')).toHaveLength(0)
		expect(document.querySelector('.question-type-fixed')?.textContent).toContain('Binary')
		const draftPreview = getDraftPreview()
		expect(within(draftPreview).getByText('Untitled question')).not.toBeNull()
		expect(within(draftPreview).getByText('Binary')).not.toBeNull()
		expect(within(draftPreview).queryByText('binary')).toBeNull()
		expect(within(draftPreview).queryByText('Add resolution notes, evidence sources, and edge-case handling so other users know how this question will settle.')).toBeNull()
		expect(within(draftPreview).queryByText('Add a clear question title')).toBeNull()
		expect(document.body.textContent?.includes('Statoblast origin security pools support this exact Yes / No question shape.')).toBe(false)
		expect(documentQueries.queryByText('Context provided')).toBeNull()
		expect(documentQueries.queryByText('Risk cue')).toBeNull()
		expect(documentQueries.queryByText('Title is required.')).toBeNull()
		expect(titleInput.getAttribute('aria-describedby')).toBeNull()
		expect(documentQueries.getByText('Missing required fields: Title.')).not.toBeNull()

		await act(() => {
			titleInput.dispatchEvent(new Event('blur'))
		})

		expect(documentQueries.getByText('Title is required.')).not.toBeNull()
		expect(getDescribedText(titleInput)).toBe('Title is required.')
	})

	test('associates chronology errors with both time fields and explains the disabled action', async () => {
		await renderSection({ marketForm: createMarketForm({ title: '', startTime: '2000', endTime: '1000' }) })

		const documentQueries = within(document.body)
		const startTimeInput = documentQueries.getByLabelText('Start time')
		const endTimeInput = documentQueries.getByLabelText('End time')
		await act(() => {
			startTimeInput.dispatchEvent(new Event('blur'))
		})

		expect(documentQueries.getAllByText('End time must be after start time.')).toHaveLength(1)
		for (const input of [startTimeInput, endTimeInput]) {
			expect(input.getAttribute('aria-invalid')).toBe('true')
			expect(input.getAttribute('aria-describedby')).toBe('market-create-timing-error market-create-time-zone')
		}
		expect(documentQueries.queryByText('Missing required fields: Title.')).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Create question', 'Missing required fields: Title. Fix invalid fields: End time must be after start time.')
	})

	test('keeps scalar details and ended-state risk visible through direct submission', async () => {
		let createCount = 0
		const scalarForm = createMarketForm({
			answerUnit: 'USD',
			endTime: '2000',
			marketType: 'scalar',
			scalarIncrement: '0.5',
			scalarMax: '10',
			scalarMin: '0',
			startTime: '',
		})
		await renderSection(
			{
				marketForm: scalarForm,
				onCreateMarket: () => {
					createCount += 1
				},
			},
			2_000_000_000n,
		)

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('This question will be created already ended. Reporting and resolution may be available immediately.')).not.toBeNull()
		const createButton = documentQueries.getByRole('button', { name: 'Create question' }) as HTMLButtonElement
		expect(createButton.disabled).toBe(false)
		expect((documentQueries.getByLabelText('Scalar min') as HTMLInputElement).value).toBe(scalarForm.scalarMin)
		expect((documentQueries.getByLabelText('Scalar max') as HTMLInputElement).value).toBe(scalarForm.scalarMax)
		expect((documentQueries.getByLabelText('Scalar increment') as HTMLInputElement).value).toBe(scalarForm.scalarIncrement)
		expect((documentQueries.getByLabelText('Answer unit') as HTMLInputElement).value).toBe(scalarForm.answerUnit)

		await act(() => {
			fireEvent.click(createButton)
		})
		expect(createCount).toBe(1)
	})

	test('uses normalized market type and Augur Statoblast terminology for categorical questions', async () => {
		await renderSection({ marketForm: createMarketForm({ marketType: 'categorical' }) })

		expect(within(getDraftPreview()).getByText('Categorical')).not.toBeNull()
		expect(within(document.body).queryByText(/Augur Statoblast origin security pools/)).toBeNull()
	})

	test('renders selected market details and triggers selection callbacks', async () => {
		let useForForkCount = 0
		let useForPoolQuestionId: string | undefined
		let resetCount = 0
		let openForkTabCount = 0
		const question = createMarketDetails()
		const marketResult: MarketCreationResult = {
			questionId: question.questionId,
			createQuestionHash: '0xhash-1',
			marketType: 'binary',
		}

		await renderSection({
			marketForm,
			marketResult,
			onOpenForkTab: () => {
				openForkTabCount += 1
			},
			onResetMarket: () => {
				resetCount += 1
			},
			onUseQuestionForFork: () => {
				useForForkCount += 1
			},
			onUseQuestionForPool: questionId => {
				useForPoolQuestionId = questionId
			},
			zoltarQuestions: [question],
		})

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: question.title })).not.toBeNull()
		expect(documentQueries.getByText(question.description)).not.toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: `Use for fork: ${question.title} (${question.questionId})` }))
			fireEvent.click(documentQueries.getByRole('button', { name: `Create pool from question: ${question.title} (${question.questionId})` }))
			fireEvent.click(documentQueries.getByRole('button', { name: 'Create another question' }))
		})

		expect(useForForkCount).toBe(1)
		expect(resetCount).toBe(1)
		expect(openForkTabCount).toBe(1)
		expect(useForPoolQuestionId).toBe(question.questionId)
	})

	test('calls categorical mutators', async () => {
		const updates: Array<Partial<MarketFormState>> = []
		await renderSection({
			marketForm: createMarketForm({
				marketType: 'categorical',
				categoricalOutcomes: ['Yes', 'No'],
			}),
			onMarketFormChange: update => {
				updates.push(update)
			},
		})

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.input(documentQueries.getByLabelText('Outcome 1') as HTMLInputElement, { target: { value: 'Up' } })
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Add outcome' }))
		})
		await act(() => {
			expect(documentQueries.getByRole('button', { name: 'Remove outcome 1' })).toBeDefined()
			expect(documentQueries.getByRole('button', { name: 'Remove outcome 2' })).toBeDefined()
			fireEvent.click(documentQueries.getByRole('button', { name: 'Remove outcome 1' }) as HTMLButtonElement)
		})
		expect(updates.some(update => update.categoricalOutcomes !== undefined)).toBe(true)
	})

	test('marks the required categorical outcome slots and associates their shared error', async () => {
		await renderSection({ marketForm: createMarketForm({ categoricalOutcomes: ['', 'Yes', 'No'], marketType: 'categorical' }) })

		const documentQueries = within(document.body)
		const outcomesGroup = document.body.querySelector('[role="group"][aria-labelledby="market-create-outcomes-label"]')
		if (!(outcomesGroup instanceof HTMLElement)) throw new Error('Expected required outcomes group')
		const outcome1 = documentQueries.getByLabelText('Outcome 1') as HTMLInputElement
		const outcome2 = documentQueries.getByLabelText('Outcome 2') as HTMLInputElement
		const outcome3 = documentQueries.getByLabelText('Outcome 3') as HTMLInputElement
		expect(outcomesGroup.querySelector('.required-field-indicator')).not.toBeNull()
		expect(outcome1.required).toBe(true)
		expect(outcome2.required).toBe(true)
		expect(outcome3.required).toBe(false)
		expect(documentQueries.queryByText('Outcome 1 is required.')).toBeNull()

		await act(() => {
			outcome1.dispatchEvent(new Event('blur'))
		})

		expect(documentQueries.getByText('Outcome 1 is required.')).not.toBeNull()
		expect(getDescribedText(outcome1)).toBe('Outcome 1 is required.')
		expect(getDescribedText(outcome2)).toBe('Outcome 1 is required.')
	})

	test('uses canonical categorical outcome ordering in the draft preview', async () => {
		const marketForm = createMarketForm({
			categoricalOutcomes: ['Cherry', 'Apple', 'Banana'],
			marketType: 'categorical',
		})
		await renderSection({ marketForm })

		expect(getDraftPreviewOutcomeLabels()).toEqual([...createMarketParameters(marketForm).outcomeLabels, 'Invalid'])
	})

	test('does not duplicate invalid in the categorical draft preview when the user already entered it', async () => {
		const marketForm = createMarketForm({
			categoricalOutcomes: ['Yes', 'Invalid', 'No'],
			marketType: 'categorical',
		})
		await renderSection({ marketForm })

		const renderedOutcomeLabels = getDraftPreviewOutcomeLabels()
		expect(renderedOutcomeLabels).toEqual(createMarketParameters(marketForm).outcomeLabels)
		expect(renderedOutcomeLabels.filter(label => label.toLowerCase() === 'invalid')).toHaveLength(1)
	})

	test('renders a user-entered lowercase invalid outcome as the single warning chip in the draft preview', async () => {
		await renderSection({
			marketForm: createMarketForm({
				categoricalOutcomes: ['Yes', 'invalid', 'No'],
				marketType: 'categorical',
			}),
		})

		const invalidChips = getDraftPreviewOutcomeChips().filter(element => element.textContent?.trim().toLowerCase() === 'invalid')
		expect(invalidChips).toHaveLength(1)
		const [invalidChip] = invalidChips
		if (!(invalidChip instanceof HTMLElement)) throw new Error('Expected invalid outcome chip')
		expect(invalidChip.className).toContain('warning')
	})

	test('uses the same scalar label in the draft preview as the final question display', async () => {
		await renderSection({ marketForm: createMarketForm({ marketType: 'scalar' }) })

		const renderedOutcomeLabels = getDraftPreviewOutcomeLabels()
		expect(renderedOutcomeLabels).toContain('Scalar')
		expect(renderedOutcomeLabels).not.toContain('Scalar value')
	})

	test('shows scalar preview guidance for malformed scalar inputs', async () => {
		await renderSection({
			isOnActiveAppChain: false,
			marketForm: createMarketForm({
				marketType: 'scalar',
				scalarIncrement: 'not-a-number',
				scalarMin: '0',
				scalarMax: '10',
			}),
		})

		expect(within(document.body).getByText('Enter scalar min, max, and increment to preview the answer range.')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Create question')
	})

	test('marks scalar range fields required and associates their contextual errors', async () => {
		await renderSection({ marketForm: createMarketForm({ marketType: 'scalar', scalarIncrement: '', scalarMax: '', scalarMin: '' }) })

		const documentQueries = within(document.body)
		const scalarFields = ['Scalar min', 'Scalar increment', 'Scalar max'].map(label => ({ input: documentQueries.getByLabelText(label) as HTMLInputElement, label }))
		for (const { input } of scalarFields) {
			expect(input.required).toBe(true)
			expect(document.querySelector(`label[for="${input.id}"] .required-field-indicator`)).not.toBeNull()
		}

		await act(() => {
			for (const { input } of scalarFields) input.dispatchEvent(new Event('blur'))
		})

		for (const { input, label } of scalarFields) {
			expect(documentQueries.getByText(`${label} is required.`)).not.toBeNull()
			expect(getDescribedText(input)).toBe(`${label} is required.`)
		}
	})

	test('calls create market handler when validation passes', async () => {
		let createCallCount = 0
		await renderSection({
			onCreateMarket: () => {
				createCallCount += 1
			},
		})

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Create question' }))
		})

		expect(createCallCount).toBe(1)
	})

	test('updates scalar form values', async () => {
		const updates: Array<Partial<MarketFormState>> = []
		await renderSection({
			marketForm: createMarketForm({
				marketType: 'scalar',
				scalarMin: '0',
				scalarMax: '100',
				scalarIncrement: '0.1',
				answerUnit: 'USD',
			}),
			onMarketFormChange: update => {
				marketForm = { ...marketForm, ...update }
				updates.push(update)
			},
		})

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.input(documentQueries.getByLabelText('Description') as HTMLTextAreaElement, { target: { value: 'A scoped scalar description' } })
			fireEvent.input(documentQueries.getByLabelText('Scalar min') as HTMLInputElement, { target: { value: '1' } })
			fireEvent.input(documentQueries.getByLabelText('Answer unit') as HTMLInputElement, { target: { value: 'USD' } })
			fireEvent.input(documentQueries.getByLabelText('Scalar increment') as HTMLInputElement, { target: { value: '1' } })
			fireEvent.input(documentQueries.getByLabelText('Scalar max') as HTMLInputElement, { target: { value: '1000' } })
		})

		expect(updates.some(update => update.description === 'A scoped scalar description')).toBe(true)
		expect(updates.some(update => update.scalarMin === '1')).toBe(true)
		expect(updates.some(update => update.answerUnit === 'USD')).toBe(true)
		expect(updates.some(update => update.scalarIncrement === '1')).toBe(true)
		expect(updates.some(update => update.scalarMax === '1000')).toBe(true)
	})

	test('renders and updates a valid scalar preview', async () => {
		await renderSection({
			marketForm: createMarketForm({
				marketType: 'scalar',
				scalarIncrement: '0.1',
				scalarMin: '1',
				scalarMax: '10',
				answerUnit: 'USD',
			}),
		})

		expect(within(document.body).getByText('Try a scalar answer')).not.toBeNull()

		const slider = document.querySelector('input[type="range"]')
		if (slider === null) throw new Error('Expected scalar slider')
		await act(() => {
			fireEvent.input(slider, { target: { value: '5' } })
		})
		expect((within(document.body).getByRole('textbox', { name: 'Scalar value' }) as HTMLInputElement).value).toBe('1.5')
		expect(within(document.body).queryByText('Selected tick')).toBeNull()
		const valueInput = within(document.body).getByRole('textbox', { name: 'Scalar value' })
		await act(() => fireEvent.input(valueInput, { target: { value: '1.55' } }))
		await act(() => valueInput.dispatchEvent(new Event('blur')))
		expect(valueInput.getAttribute('aria-invalid')).toBe('true')
		await act(() => fireEvent.input(valueInput, { target: { value: '2.5' } }))
		expect(valueInput.getAttribute('aria-invalid')).not.toBe('true')
	})

	test('shows loading and missing-question detail states', async () => {
		const result: MarketCreationResult = {
			questionId: '0xquestion-2',
			createQuestionHash: '0xhash-2',
			marketType: 'scalar',
		}
		const scalarResultProps = {
			hasForked: true,
			marketForm: createMarketForm({ marketType: 'scalar', scalarMin: '0', scalarMax: '10', scalarIncrement: '1' }),
			marketResult: result,
		}

		const loadingRender = await renderSection({ ...scalarResultProps, loadingZoltarQuestions: true })
		expect(within(document.body).getByRole('status', { name: 'Loading question details…' })).not.toBeNull()
		await loadingRender.cleanup()
		cleanupRenderedComponent = undefined

		await renderSection({ ...scalarResultProps, marketError: 'Unable to load details' })
		const missingQueries = within(document.body)
		expect(missingQueries.getByText('Question details are unavailable.')).not.toBeNull()
		expect(missingQueries.getByRole('button', { name: `Universe already forked: Question (${result.questionId})` })).not.toBeNull()
		expect(missingQueries.getByText('Unable to load details')).not.toBeNull()
		expect(missingQueries.getByRole('alert').textContent).toContain('Unable to load details')
		expect(document.body.textContent).not.toContain('Create pool from question')
	})
})
