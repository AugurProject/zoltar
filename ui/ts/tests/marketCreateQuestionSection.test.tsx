/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { act } from 'preact/test-utils'
import { zeroAddress } from 'viem'
import { MarketCreateQuestionSection } from '../components/MarketCreateQuestionSection.js'
import { createMarketParameters } from '../lib/marketCreation.js'
import type { MarketFormState } from '../types/app.js'
import type { MarketCreationResult, MarketDetails } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled } from './testUtils/transactionActionButton.js'

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
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Question description',
		displayValueMax: 10n,
		displayValueMin: 0n,
		endTime: 2000n,
		exists: true,
		marketType: 'binary',
		numTicks: 10n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0xquestion-1',
		startTime: 1000n,
		title: 'Binary question',
		...overrides,
	}
}

describe('MarketCreateQuestionSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let marketForm = createMarketForm()

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		marketForm = createMarketForm()
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('collects form updates and blocks create without wallet', async () => {
		const updates: Array<Partial<MarketFormState>> = []
		const renderedComponent = await renderIntoDocument(
			<MarketCreateQuestionSection
				accountAddress={undefined}
				hasForked={false}
				isMainnet={false}
				marketCreating={false}
				marketError={undefined}
				marketForm={marketForm}
				marketResult={undefined}
				loadingZoltarQuestions={false}
				onCreateMarket={() => {
					throw new Error('create should remain unavailable')
				}}
				onMarketFormChange={update => {
					marketForm = { ...marketForm, ...update }
					updates.push(update)
				}}
				onOpenForkTab={() => undefined}
				onResetMarket={() => undefined}
				onUseQuestionForFork={() => undefined}
				onUseQuestionForPool={() => undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const questionTypeButton = documentQueries.getByRole('button', { name: 'Question Type: Binary' })
		await act(() => {
			fireEvent.click(questionTypeButton)
		})
		await act(() => {
			const options = documentQueries.getAllByRole('option') as HTMLButtonElement[]
			const categoricalOption = options.find(option => option.textContent?.includes('Categorical') === true)
			if (categoricalOption === undefined) throw new Error('Expected categorical option')
			fireEvent.click(categoricalOption)
		})
		await act(() => {
			fireEvent.input(documentQueries.getByLabelText('Title') as HTMLInputElement, { target: { value: 'Updated title' } })
		})
		await act(() => {
			fireEvent.input(documentQueries.getByLabelText('Start Time') as HTMLInputElement, { target: { value: '1200' } })
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Create Question' }))
		})

		expectTransactionButtonDisabled(document.body, 'Create Question', 'Connect a wallet before creating a question.')
		expect(updates.some(update => update.marketType === 'categorical')).toBe(true)
		expect(updates.some(update => update.title === 'Updated title')).toBe(true)
	})

	test('shows timing guidance without duplicating validation notices', async () => {
		const renderedComponent = await renderIntoDocument(
			<MarketCreateQuestionSection
				accountAddress={zeroAddress}
				hasForked={false}
				isMainnet={true}
				marketCreating={false}
				marketError={undefined}
				marketForm={createMarketForm({ title: '' })}
				marketResult={undefined}
				loadingZoltarQuestions={false}
				onCreateMarket={() => undefined}
				onMarketFormChange={() => undefined}
				onOpenForkTab={() => undefined}
				onResetMarket={() => undefined}
				onUseQuestionForFork={() => undefined}
				onUseQuestionForPool={() => undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const titleInput = documentQueries.getByLabelText('Title')
		expect(documentQueries.getByText('Times use your browser timezone. Leave start time blank to allow activity immediately after creation. Reporting and trading settlement depend on the end time.')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Question Type Guidance' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Draft Preview' })).not.toBeNull()
		expect(documentQueries.getByText('Placeholder origin security pools support this exact Yes / No question shape.')).not.toBeNull()
		expect(documentQueries.getByText('Title is required')).not.toBeNull()
		expect(titleInput.getAttribute('aria-describedby')).toBe('market-create-title-error')
		expect(documentQueries.getAllByText('Missing required fields: Title')).toHaveLength(1)
	})

	test('renders selected market details and triggers selection callbacks', async () => {
		let useForForkCount = 0
		let useForPoolCount = 0
		let resetCount = 0
		let openForkTabCount = 0
		const question = createMarketDetails()
		const marketResult: MarketCreationResult = {
			questionId: question.questionId,
			createQuestionHash: '0xhash-1',
			marketType: 'binary',
		}

		const renderedComponent = await renderIntoDocument(
			<MarketCreateQuestionSection
				accountAddress={zeroAddress}
				hasForked={false}
				isMainnet={true}
				marketCreating={false}
				marketError={undefined}
				marketForm={marketForm}
				marketResult={marketResult}
				loadingZoltarQuestions={false}
				onCreateMarket={() => undefined}
				onMarketFormChange={() => undefined}
				onOpenForkTab={() => {
					openForkTabCount += 1
				}}
				onResetMarket={() => {
					resetCount += 1
				}}
				onUseQuestionForFork={() => {
					useForForkCount += 1
				}}
				onUseQuestionForPool={() => {
					useForPoolCount += 1
				}}
				zoltarQuestions={[question]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: question.title })).not.toBeNull()
		expect(documentQueries.getByText(question.description)).not.toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Use For Fork' }))
			fireEvent.click(documentQueries.getByRole('button', { name: 'Create Pool From Question' }))
			fireEvent.click(documentQueries.getByRole('button', { name: 'Create Another Question' }))
		})

		expect(useForForkCount).toBe(1)
		expect(useForPoolCount).toBe(1)
		expect(resetCount).toBe(1)
		expect(openForkTabCount).toBe(1)
	})

	test('calls categorical mutators', async () => {
		const updates: Array<Partial<MarketFormState>> = []
		const renderedComponent = await renderIntoDocument(
			<MarketCreateQuestionSection
				accountAddress={zeroAddress}
				hasForked={false}
				isMainnet={true}
				marketCreating={false}
				marketError={undefined}
				marketForm={createMarketForm({
					marketType: 'categorical',
					categoricalOutcomes: ['Yes', 'No'],
				})}
				marketResult={undefined}
				loadingZoltarQuestions={false}
				onCreateMarket={() => {
					throw new Error('create should remain unavailable')
				}}
				onMarketFormChange={update => {
					updates.push(update)
				}}
				onOpenForkTab={() => undefined}
				onResetMarket={() => undefined}
				onUseQuestionForFork={() => undefined}
				onUseQuestionForPool={() => undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.input(documentQueries.getByLabelText('Outcome 1') as HTMLInputElement, { target: { value: 'Up' } })
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Add Outcome' }))
		})
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Remove' })[0] as HTMLButtonElement)
		})
		expect(updates.some(update => update.categoricalOutcomes !== undefined)).toBe(true)
	})

	test('uses canonical categorical outcome ordering in the draft preview', async () => {
		const marketForm = createMarketForm({
			categoricalOutcomes: ['Cherry', 'Apple', 'Banana'],
			marketType: 'categorical',
		})
		const expectedOutcomeLabels = [...createMarketParameters(marketForm).outcomeLabels, 'Invalid']
		const renderedComponent = await renderIntoDocument(
			<MarketCreateQuestionSection
				accountAddress={zeroAddress}
				hasForked={false}
				isMainnet={true}
				marketCreating={false}
				marketError={undefined}
				marketForm={marketForm}
				marketResult={undefined}
				loadingZoltarQuestions={false}
				onCreateMarket={() => undefined}
				onMarketFormChange={() => undefined}
				onOpenForkTab={() => undefined}
				onResetMarket={() => undefined}
				onUseQuestionForFork={() => undefined}
				onUseQuestionForPool={() => undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const draftPreviewHeading = within(document.body).getByRole('heading', { name: 'Draft Preview' })
		const draftPreviewSection = draftPreviewHeading.closest('section')
		if (!(draftPreviewSection instanceof HTMLElement)) throw new Error('Expected draft preview section')
		const renderedOutcomeLabels = Array.from(draftPreviewSection.querySelectorAll('.outcome-chip')).map(element => element.textContent?.trim() ?? '')
		expect(renderedOutcomeLabels).toEqual(expectedOutcomeLabels)
	})

	test('does not duplicate invalid in the categorical draft preview when the user already entered it', async () => {
		const marketForm = createMarketForm({
			categoricalOutcomes: ['Yes', 'Invalid', 'No'],
			marketType: 'categorical',
		})
		const expectedOutcomeLabels = createMarketParameters(marketForm).outcomeLabels
		const renderedComponent = await renderIntoDocument(
			<MarketCreateQuestionSection
				accountAddress={zeroAddress}
				hasForked={false}
				isMainnet={true}
				marketCreating={false}
				marketError={undefined}
				marketForm={marketForm}
				marketResult={undefined}
				loadingZoltarQuestions={false}
				onCreateMarket={() => undefined}
				onMarketFormChange={() => undefined}
				onOpenForkTab={() => undefined}
				onResetMarket={() => undefined}
				onUseQuestionForFork={() => undefined}
				onUseQuestionForPool={() => undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const draftPreviewHeading = within(document.body).getByRole('heading', { name: 'Draft Preview' })
		const draftPreviewSection = draftPreviewHeading.closest('section')
		if (!(draftPreviewSection instanceof HTMLElement)) throw new Error('Expected draft preview section')
		const renderedOutcomeLabels = Array.from(draftPreviewSection.querySelectorAll('.outcome-chip')).map(element => element.textContent?.trim() ?? '')
		expect(renderedOutcomeLabels).toEqual(expectedOutcomeLabels)
		expect(renderedOutcomeLabels.filter(label => label.toLowerCase() === 'invalid')).toHaveLength(1)
	})

	test('renders a user-entered lowercase invalid outcome as the single warning chip in the draft preview', async () => {
		const marketForm = createMarketForm({
			categoricalOutcomes: ['Yes', 'invalid', 'No'],
			marketType: 'categorical',
		})
		const renderedComponent = await renderIntoDocument(
			<MarketCreateQuestionSection
				accountAddress={zeroAddress}
				hasForked={false}
				isMainnet={true}
				marketCreating={false}
				marketError={undefined}
				marketForm={marketForm}
				marketResult={undefined}
				loadingZoltarQuestions={false}
				onCreateMarket={() => undefined}
				onMarketFormChange={() => undefined}
				onOpenForkTab={() => undefined}
				onResetMarket={() => undefined}
				onUseQuestionForFork={() => undefined}
				onUseQuestionForPool={() => undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const draftPreviewHeading = within(document.body).getByRole('heading', { name: 'Draft Preview' })
		const draftPreviewSection = draftPreviewHeading.closest('section')
		if (!(draftPreviewSection instanceof HTMLElement)) throw new Error('Expected draft preview section')
		const renderedOutcomeLabels = Array.from(draftPreviewSection.querySelectorAll('.outcome-chip')).map(element => element.textContent?.trim() ?? '')
		expect(renderedOutcomeLabels.filter(label => label.toLowerCase() === 'invalid')).toHaveLength(1)

		const invalidChip = Array.from(draftPreviewSection.querySelectorAll('.outcome-chip')).find(element => element.textContent?.trim().toLowerCase() === 'invalid')
		if (!(invalidChip instanceof HTMLElement)) throw new Error('Expected invalid outcome chip')
		expect(invalidChip.className).toContain('warning')
	})

	test('uses the same scalar label in the draft preview as the final question display', async () => {
		const renderedComponent = await renderIntoDocument(
			<MarketCreateQuestionSection
				accountAddress={zeroAddress}
				hasForked={false}
				isMainnet={true}
				marketCreating={false}
				marketError={undefined}
				marketForm={createMarketForm({
					marketType: 'scalar',
				})}
				marketResult={undefined}
				loadingZoltarQuestions={false}
				onCreateMarket={() => undefined}
				onMarketFormChange={() => undefined}
				onOpenForkTab={() => undefined}
				onResetMarket={() => undefined}
				onUseQuestionForFork={() => undefined}
				onUseQuestionForPool={() => undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const draftPreviewHeading = within(document.body).getByRole('heading', { name: 'Draft Preview' })
		const draftPreviewSection = draftPreviewHeading.closest('section')
		if (!(draftPreviewSection instanceof HTMLElement)) throw new Error('Expected draft preview section')
		const renderedOutcomeLabels = Array.from(draftPreviewSection.querySelectorAll('.outcome-chip')).map(element => element.textContent?.trim() ?? '')
		expect(renderedOutcomeLabels).toContain('Scalar')
		expect(renderedOutcomeLabels).not.toContain('Scalar value')
	})

	test('shows scalar preview guidance for malformed scalar inputs', async () => {
		const renderedComponent = await renderIntoDocument(
			<MarketCreateQuestionSection
				accountAddress={zeroAddress}
				hasForked={false}
				isMainnet={false}
				marketCreating={false}
				marketError={undefined}
				marketForm={createMarketForm({
					marketType: 'scalar',
					scalarIncrement: 'not-a-number',
					scalarMin: '0',
					scalarMax: '10',
				})}
				marketResult={undefined}
				loadingZoltarQuestions={false}
				onCreateMarket={() => {
					throw new Error('create should remain unavailable')
				}}
				onMarketFormChange={() => undefined}
				onOpenForkTab={() => undefined}
				onResetMarket={() => undefined}
				onUseQuestionForFork={() => undefined}
				onUseQuestionForPool={() => undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Enter scalar min, max, and increment to preview the tick slider.')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Create Question', 'Switch to Ethereum mainnet before creating a question.')
	})

	test('calls create market handler when validation passes', async () => {
		let createCallCount = 0

		const renderedComponent = await renderIntoDocument(
			<MarketCreateQuestionSection
				accountAddress={zeroAddress}
				hasForked={false}
				isMainnet={true}
				marketCreating={false}
				marketError={undefined}
				marketForm={createMarketForm()}
				marketResult={undefined}
				loadingZoltarQuestions={false}
				onCreateMarket={() => {
					createCallCount += 1
				}}
				onMarketFormChange={() => undefined}
				onOpenForkTab={() => undefined}
				onResetMarket={() => undefined}
				onUseQuestionForFork={() => undefined}
				onUseQuestionForPool={() => undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Create Question' }))
		})

		expect(createCallCount).toBe(1)
	})

	test('updates scalar form values', async () => {
		const updates: Array<Partial<MarketFormState>> = []

		const renderedComponent = await renderIntoDocument(
			<MarketCreateQuestionSection
				accountAddress={zeroAddress}
				hasForked={false}
				isMainnet={true}
				marketCreating={false}
				marketError={undefined}
				marketForm={createMarketForm({
					marketType: 'scalar',
					scalarMin: '0',
					scalarMax: '100',
					scalarIncrement: '0.1',
					answerUnit: 'USD',
				})}
				marketResult={undefined}
				loadingZoltarQuestions={false}
				onCreateMarket={() => undefined}
				onMarketFormChange={update => {
					marketForm = { ...marketForm, ...update }
					updates.push(update)
				}}
				onOpenForkTab={() => undefined}
				onResetMarket={() => undefined}
				onUseQuestionForFork={() => undefined}
				onUseQuestionForPool={() => undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)

		await act(() => {
			fireEvent.input(documentQueries.getByLabelText('Description') as HTMLTextAreaElement, { target: { value: 'A scoped scalar description' } })
			fireEvent.input(documentQueries.getByLabelText('Scalar Min') as HTMLInputElement, { target: { value: '1' } })
			fireEvent.input(documentQueries.getByLabelText('Answer Unit') as HTMLInputElement, { target: { value: 'USD' } })
			fireEvent.input(documentQueries.getByLabelText('Scalar Increment') as HTMLInputElement, { target: { value: '1' } })
			fireEvent.input(documentQueries.getByLabelText('Scalar Max') as HTMLInputElement, { target: { value: '1000' } })
		})

		expect(updates.some(update => update.description === 'A scoped scalar description')).toBe(true)
		expect(updates.some(update => update.scalarMin === '1')).toBe(true)
		expect(updates.some(update => update.answerUnit === 'USD')).toBe(true)
		expect(updates.some(update => update.scalarIncrement === '1')).toBe(true)
		expect(updates.some(update => update.scalarMax === '1000')).toBe(true)
	})

	test('renders and updates a valid scalar preview', async () => {
		const renderedComponent = await renderIntoDocument(
			<MarketCreateQuestionSection
				accountAddress={zeroAddress}
				hasForked={false}
				isMainnet={true}
				marketCreating={false}
				marketError={undefined}
				marketForm={createMarketForm({
					marketType: 'scalar',
					scalarIncrement: '0.1',
					scalarMin: '1',
					scalarMax: '10',
					answerUnit: 'USD',
				})}
				marketResult={undefined}
				loadingZoltarQuestions={false}
				onCreateMarket={() => undefined}
				onMarketFormChange={() => undefined}
				onOpenForkTab={() => undefined}
				onResetMarket={() => undefined}
				onUseQuestionForFork={() => undefined}
				onUseQuestionForPool={() => undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Scalar Preview')).not.toBeNull()

		const slider = document.querySelector('input[type="range"]')
		if (slider === null) throw new Error('Expected scalar slider')
		await act(() => {
			fireEvent.input(slider, { target: { value: '5' } })
		})
		expect(document.body.textContent).toContain('5 / 90')
	})

	test('shows loading and missing-question detail states', async () => {
		const result: MarketCreationResult = {
			questionId: '0xquestion-2',
			createQuestionHash: '0xhash-2',
			marketType: 'scalar',
		}

		const loadingRender = await renderIntoDocument(
			<MarketCreateQuestionSection
				accountAddress={zeroAddress}
				hasForked={true}
				isMainnet={true}
				marketCreating={false}
				marketError={undefined}
				marketForm={createMarketForm({ marketType: 'scalar', scalarMin: '0', scalarMax: '10', scalarIncrement: '1' })}
				marketResult={result}
				loadingZoltarQuestions={true}
				onCreateMarket={() => undefined}
				onMarketFormChange={() => undefined}
				onOpenForkTab={() => undefined}
				onResetMarket={() => undefined}
				onUseQuestionForFork={() => undefined}
				onUseQuestionForPool={() => undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = loadingRender.cleanup
		const loadingQueries = within(document.body)
		expect(loadingQueries.getByRole('status', { name: 'Loading question details' })).not.toBeNull()
		await loadingRender.cleanup()
		cleanupRenderedComponent = undefined

		const missingRender = await renderIntoDocument(
			<MarketCreateQuestionSection
				accountAddress={zeroAddress}
				hasForked={true}
				isMainnet={true}
				marketCreating={false}
				marketError='Unable to load details'
				marketForm={createMarketForm({ marketType: 'scalar', scalarMin: '0', scalarMax: '10', scalarIncrement: '1' })}
				marketResult={result}
				loadingZoltarQuestions={false}
				onCreateMarket={() => undefined}
				onMarketFormChange={() => undefined}
				onOpenForkTab={() => undefined}
				onResetMarket={() => undefined}
				onUseQuestionForFork={() => undefined}
				onUseQuestionForPool={() => undefined}
				zoltarQuestions={[]}
			/>,
		)
		cleanupRenderedComponent = missingRender.cleanup
		const missingQueries = within(document.body)
		expect(missingQueries.getByText('Question details are not loaded yet.')).not.toBeNull()
		expect(missingQueries.getByRole('button', { name: 'Already Forked' })).not.toBeNull()
		expect(missingQueries.getByText('Unable to load details')).not.toBeNull()
		expect(missingQueries.getByRole('button', { name: 'Create Pool From Question' }).getAttribute('disabled')).toBe('')
	})
})
