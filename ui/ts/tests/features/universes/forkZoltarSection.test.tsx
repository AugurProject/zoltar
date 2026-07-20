/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { fireEvent, within } from '../../testUtils/queries'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ForkZoltarSection } from '../../../features/universes/components/ForkZoltarSection.js'
import type { MarketDetails, ZoltarUniverseSummary } from '../../../types/contracts.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'

const REP = 10n ** 18n
const ZOLTAR_ADDRESS = '0x00000000000000000000000000000000000000a1' as const

function createQuestion(): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Fork question',
		displayValueMax: 2n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x01',
		startTime: 1n,
		title: 'Fork question title',
	}
}

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [],
		forkThreshold: 100n,
		forkQuestionDetails: undefined,
		forkTime: 0n,
		forkingOutcomeIndex: 0n,
		hasForked: false,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupply: 1000n,
		universeId: 1n,
		...overrides,
	}
}

describe('ForkZoltarSection', () => {
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

	test('keeps REP approval disabled off mainnet and explains recovery', async () => {
		const renderedComponent = await renderIntoDocument(
			h(ForkZoltarSection, {
				accountAddress: zeroAddress,
				hasLoadedZoltarQuestions: true,
				isMainnet: false,
				loadingZoltarForkAccess: false,
				loadingZoltarQuestions: false,
				onApproveZoltarForkRep: () => undefined,
				onForkZoltar: () => undefined,
				onZoltarForkQuestionIdChange: () => undefined,
				zoltarForkActiveAction: undefined,
				zoltarForkApproval: {
					error: undefined,
					loading: false,
					value: 0n,
				},
				zoltarForkError: undefined,
				zoltarForkPending: false,
				zoltarForkQuestionId: '0x01',
				zoltarForkRepBalance: 1000n,
				zoltarQuestions: [createQuestion()],
				zoltarUniverse: createUniverse(),
				zoltarUniverseState: 'ready',
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const approveButton = within(document.body)
			.getAllByRole('button')
			.find(button => button.textContent?.startsWith('Approve ') === true)
		if (approveButton === undefined) throw new Error('Expected approval button')
		expect(approveButton.hasAttribute('disabled')).toBe(true)
		expect(document.body.textContent?.includes('Switch to Ethereum mainnet')).toBe(true)
	})

	test('requires a valid fork question before REP approval', async () => {
		const createProps = (questionId: string) => ({
			accountAddress: zeroAddress,
			hasLoadedZoltarQuestions: true,
			isMainnet: true,
			loadingZoltarForkAccess: false,
			loadingZoltarQuestions: false,
			onApproveZoltarForkRep: () => undefined,
			onForkZoltar: () => undefined,
			onZoltarForkQuestionIdChange: () => undefined,
			zoltarForkActiveAction: undefined,
			zoltarForkApproval: { error: undefined, loading: false, value: 0n },
			zoltarForkError: undefined,
			zoltarForkPending: false,
			zoltarForkQuestionId: questionId,
			zoltarForkRepBalance: 1000n,
			zoltarQuestions: [createQuestion()],
			zoltarUniverse: createUniverse(),
			zoltarUniverseState: 'ready' as const,
		})

		for (const questionId of ['', '0x02']) {
			const renderedComponent = await renderIntoDocument(h(ForkZoltarSection, createProps(questionId)))
			const approveButton = within(renderedComponent.container)
				.getAllByRole('button')
				.find(button => button.textContent?.startsWith('Approve ') === true)
			if (approveButton === undefined) throw new Error('Expected approval button')
			expect(approveButton.hasAttribute('disabled')).toBe(true)
			expect(renderedComponent.container.textContent).toContain('Select a valid fork question before approving REP or forking Zoltar.')
			const review = within(renderedComponent.container).getByRole('heading', { name: 'Transaction Review' }).closest('section')
			if (review === null) throw new Error('Expected transaction review')
			expect(review.textContent).not.toContain('Selected Fork Question')
			expect(review.textContent).not.toContain('Select a valid fork question before approving REP or forking Zoltar.')
			await renderedComponent.cleanup()
		}

		const renderedComponent = await renderIntoDocument(h(ForkZoltarSection, createProps('0x01')))
		cleanupRenderedComponent = renderedComponent.cleanup
		const approveButton = within(renderedComponent.container)
			.getAllByRole('button')
			.find(button => button.textContent?.startsWith('Approve ') === true)
		if (approveButton === undefined) throw new Error('Expected approval button')
		expect(approveButton.hasAttribute('disabled')).toBe(false)
	})

	test('shows 1:1 fork migration credit and the Zoltar target before submission', async () => {
		const renderedComponent = await renderIntoDocument(
			h(ForkZoltarSection, {
				accountAddress: zeroAddress,
				hasLoadedZoltarQuestions: true,
				isMainnet: true,
				loadingZoltarForkAccess: false,
				loadingZoltarQuestions: false,
				onApproveZoltarForkRep: () => undefined,
				onForkZoltar: () => undefined,
				onZoltarForkQuestionIdChange: () => undefined,
				zoltarForkActiveAction: undefined,
				zoltarForkApproval: { error: undefined, loading: false, value: 100n * REP },
				zoltarForkError: undefined,
				zoltarForkPending: false,
				zoltarForkQuestionId: '0x01',
				zoltarForkRepBalance: 1000n * REP,
				zoltarQuestions: [createQuestion()],
				zoltarUniverse: createUniverse({ forkThreshold: 100n * REP, zoltarAddress: ZOLTAR_ADDRESS }),
				zoltarUniverseState: 'ready',
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const review = within(document.body).getByRole('heading', { name: 'Transaction Review' }).closest('section')
		if (review === null) throw new Error('Expected transaction review')
		expect(review.textContent).toContain('Migration Custody Credit≈ 100.00 REP')
		expect(review.textContent).toContain('Permanent REP Burn≈ 0.00 REP')
		expect(review.textContent).toContain('Zoltar Contract')
		expect(review.textContent).toContain(ZOLTAR_ADDRESS)
		expect(review.textContent).not.toContain('Protocol FeeNone')
	})

	test('requires the user to type the irreversible fork confirmation before submission', async () => {
		const onForkZoltar = mock(() => undefined)
		const renderedComponent = await renderIntoDocument(
			h(ForkZoltarSection, {
				accountAddress: zeroAddress,
				hasLoadedZoltarQuestions: true,
				isMainnet: true,
				loadingZoltarForkAccess: false,
				loadingZoltarQuestions: false,
				onApproveZoltarForkRep: () => undefined,
				onForkZoltar,
				onZoltarForkQuestionIdChange: () => undefined,
				zoltarForkActiveAction: undefined,
				zoltarForkApproval: { error: undefined, loading: false, value: 100n * REP },
				zoltarForkError: undefined,
				zoltarForkPending: false,
				zoltarForkQuestionId: '0x01',
				zoltarForkRepBalance: 1000n * REP,
				zoltarQuestions: [createQuestion()],
				zoltarUniverse: createUniverse({ forkThreshold: 100n * REP, zoltarAddress: ZOLTAR_ADDRESS }),
				zoltarUniverseState: 'ready',
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const confirmationInput = documentQueries.getByRole('textbox', { name: 'Type FORK to confirm' })
		const forkButton = documentQueries.getByRole('button', { name: 'Fork Zoltar' })
		expect(forkButton.hasAttribute('disabled')).toBe(true)

		fireEvent.input(confirmationInput, { target: { value: 'FORK' } })
		expect(forkButton.hasAttribute('disabled')).toBe(false)
		fireEvent.click(forkButton)
		expect(onForkZoltar).toHaveBeenCalledTimes(1)
	})

	test('requires fresh confirmation when the selected fork question changes', async () => {
		const createProps = (questionId: string) => ({
			accountAddress: zeroAddress,
			hasLoadedZoltarQuestions: true,
			isMainnet: true,
			loadingZoltarForkAccess: false,
			loadingZoltarQuestions: false,
			onApproveZoltarForkRep: () => undefined,
			onForkZoltar: () => undefined,
			onZoltarForkQuestionIdChange: () => undefined,
			zoltarForkActiveAction: undefined,
			zoltarForkApproval: { error: undefined, loading: false, value: 100n * REP },
			zoltarForkError: undefined,
			zoltarForkPending: false,
			zoltarForkQuestionId: questionId,
			zoltarForkRepBalance: 1000n * REP,
			zoltarQuestions: [
				createQuestion(),
				{
					...createQuestion(),
					questionId: '0x02',
					title: 'Second fork question title',
				},
			],
			zoltarUniverse: createUniverse({ forkThreshold: 100n * REP, zoltarAddress: ZOLTAR_ADDRESS }),
			zoltarUniverseState: 'ready' as const,
		})
		const renderedComponent = await renderIntoDocument(h(ForkZoltarSection, createProps('0x01')))
		cleanupRenderedComponent = renderedComponent.cleanup
		const componentQueries = within(renderedComponent.container)
		const confirmationInput = componentQueries.getByRole('textbox', { name: 'Type FORK to confirm' }) as HTMLInputElement
		const forkButton = componentQueries.getByRole('button', { name: 'Fork Zoltar' })

		fireEvent.input(confirmationInput, { target: { value: 'FORK' } })
		expect(forkButton.hasAttribute('disabled')).toBe(false)

		render(h(ForkZoltarSection, createProps('0x02')), renderedComponent.container)

		expect(confirmationInput.value).toBe('')
		expect(forkButton.hasAttribute('disabled')).toBe(true)
	})

	test('gives direct recovery when the fork question ID is missing', async () => {
		const renderedComponent = await renderIntoDocument(
			h(ForkZoltarSection, {
				accountAddress: zeroAddress,
				hasLoadedZoltarQuestions: true,
				isMainnet: true,
				loadingZoltarForkAccess: false,
				loadingZoltarQuestions: false,
				onApproveZoltarForkRep: () => undefined,
				onForkZoltar: () => undefined,
				onZoltarForkQuestionIdChange: () => undefined,
				zoltarForkActiveAction: undefined,
				zoltarForkApproval: { error: undefined, loading: false, value: 0n },
				zoltarForkError: undefined,
				zoltarForkPending: false,
				zoltarForkQuestionId: '0x02',
				zoltarForkRepBalance: 1000n,
				zoltarQuestions: [createQuestion()],
				zoltarUniverse: createUniverse(),
				zoltarUniverseState: 'ready',
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('No question matches this ID. Try another question ID.')).not.toBeNull()
		expect(document.body.textContent?.includes('Refresh questions')).toBe(false)
	})
})
