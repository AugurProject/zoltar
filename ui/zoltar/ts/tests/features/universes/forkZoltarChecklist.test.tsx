/// <reference types="bun-types" />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { getTransactionButtonState } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { MarketDetails, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { ForkZoltarSection } from '@zoltar/ui-zoltar-shared/features/universes/components/ForkZoltarSection.js'
import { describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'

const ATTO_REP = 10n ** 18n
const ZOLTAR_ADDRESS = '0x00000000000000000000000000000000000000a1' as const

function createQuestion(overrides: Partial<MarketDetails> = {}): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: '',
		displayValueMax: 2n,
		displayValueMin: 0n,
		endTime: 50n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x01',
		startTime: 1n,
		title: 'Ended election',
		...overrides,
	}
}

const questions = [createQuestion(), createQuestion({ endTime: 500n, questionId: '0x02', title: 'Future election' }), createQuestion({ endTime: 60n, questionId: '0x03', title: 'Ended match' })]

function createUniverse(): ZoltarUniverseSummary {
	return {
		childUniverses: [],
		forkBurnDivisor: 5n,
		forkQuestionDetails: undefined,
		forkThresholdAttoRep: 450n * ATTO_REP,
		forkTime: 0n,
		forkingOutcomeIndex: 0n,
		hasForked: false,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupplyAttoRep: 9000n * ATTO_REP,
		universeId: 0n,
		zoltarAddress: ZOLTAR_ADDRESS,
	}
}

function createProps(overrides: Partial<Parameters<typeof ForkZoltarSection>[0]> = {}): Parameters<typeof ForkZoltarSection>[0] {
	return {
		accountAddress: zeroAddress,
		currentTimestamp: 100n,
		hasLoadedZoltarQuestions: true,
		isOnActiveAppChain: true,
		loadingZoltarForkAccess: false,
		loadingZoltarQuestions: false,
		onApproveZoltarForkRep: () => undefined,
		onForkZoltar: () => undefined,
		onZoltarForkQuestionIdChange: () => undefined,
		zoltarForkActiveAction: undefined,
		zoltarForkApproval: { error: undefined, loading: false, value: 450n * ATTO_REP },
		zoltarForkError: undefined,
		zoltarForkPending: false,
		zoltarForkQuestionId: '',
		zoltarForkRepBalanceAttoRep: 500n * ATTO_REP,
		zoltarQuestions: questions,
		zoltarUniverse: createUniverse(),
		zoltarUniverseState: 'ready',
		...overrides,
	}
}

function getStepStatuses(container: HTMLElement) {
	return [...container.querySelectorAll('.fork-checklist-step')].map(step => {
		const status = ['done', 'blocked', 'pending'].find(candidate => step.classList.contains(candidate))
		return `${step.getAttribute('data-step')}:${status ?? 'unknown'}`
	})
}

describe('ForkZoltarSection checklist', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('lists only ended questions and selects one by title search', async () => {
		const selectedQuestionIds: string[] = []
		const renderedComponent = await renderIntoDocument(h(ForkZoltarSection, createProps({ onZoltarForkQuestionIdChange: questionId => selectedQuestionIds.push(questionId) })))
		cleanupRenderedComponent = renderedComponent.cleanup
		const queries = within(renderedComponent.container)

		expect(queries.getByRole('button', { name: /Ended match/ })).not.toBeNull()
		expect(queries.getByRole('button', { name: /Ended election/ })).not.toBeNull()
		expect(queries.queryByRole('button', { name: /Future election/ })).toBeNull()
		expect(renderedComponent.container.querySelector('.fork-question-id-fallback')?.hasAttribute('open')).toBe(false)

		await act(() => {
			fireEvent.input(queries.getByLabelText('Search ended questions'), { target: { value: 'match' } })
		})
		expect(queries.queryByRole('button', { name: /Ended election/ })).toBeNull()
		await act(() => {
			fireEvent.click(queries.getByRole('button', { name: /Ended match/ }))
		})
		expect(selectedQuestionIds).toEqual(['0x03'])
		expect(getStepStatuses(renderedComponent.container)).toEqual(['question:pending', 'rep:done', 'approval:done', 'review:blocked'])
		expect(getTransactionButtonState(document.body, 'Fork Universe').disabled).toBe(true)
	})

	test('shows the exact REP shortfall and keeps the fork disabled', async () => {
		const onForkZoltar = mock(() => undefined)
		const renderedComponent = await renderIntoDocument(h(ForkZoltarSection, createProps({ onForkZoltar, zoltarForkQuestionId: '0x01', zoltarForkRepBalanceAttoRep: 120n * ATTO_REP })))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getStepStatuses(renderedComponent.container)).toEqual(['question:done', 'rep:blocked', 'approval:done', 'review:blocked'])
		const shortfall = 'You have 120 REP; 450 REP needed (330 short).'
		expect(renderedComponent.container.querySelector('[data-step="rep"] .fork-checklist-reason')?.textContent).toBe(shortfall)
		const forkState = getTransactionButtonState(document.body, 'Fork Universe')
		expect(forkState.disabled).toBe(true)
		expect(forkState.reason).toBe(shortfall)
		expect(renderedComponent.container.textContent?.split(shortfall).length).toBe(2)
		fireEvent.click(within(document.body).getByRole('button', { name: 'Fork Universe' }))
		expect(onForkZoltar).not.toHaveBeenCalled()
	})

	test('marks every prerequisite done and enables the final fork step', async () => {
		const onForkZoltar = mock(() => undefined)
		const renderedComponent = await renderIntoDocument(h(ForkZoltarSection, createProps({ onForkZoltar, zoltarForkQuestionId: '0x01' })))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getStepStatuses(renderedComponent.container)).toEqual(['question:done', 'rep:done', 'approval:done', 'review:pending'])
		expect(renderedComponent.container.querySelector('[aria-current="step"]')?.getAttribute('data-step')).toBe('review')
		expect(within(renderedComponent.container).getByRole('button', { name: 'Change question' })).not.toBeNull()
		const forkButton = within(document.body).getByRole('button', { name: 'Fork Universe' })
		expect(forkButton.hasAttribute('disabled')).toBe(false)
		fireEvent.click(forkButton)
		expect(onForkZoltar).toHaveBeenCalledTimes(1)
	})

	test('blocks a selected question that has not ended and offers another choice', async () => {
		const renderedComponent = await renderIntoDocument(h(ForkZoltarSection, createProps({ zoltarForkQuestionId: '0x02' })))
		cleanupRenderedComponent = renderedComponent.cleanup
		const queries = within(renderedComponent.container)

		expect(getStepStatuses(renderedComponent.container)[0]).toBe('question:blocked')
		expect(renderedComponent.container.querySelector('[data-step="question"] .fork-checklist-reason')?.textContent).toContain('The selected question must end before the universe can fork.')
		await act(() => {
			fireEvent.click(queries.getByRole('button', { name: 'Change question' }))
		})
		expect(queries.getByLabelText('Search ended questions')).not.toBeNull()
	})

	test('loads every question once when the picker opens without them', async () => {
		const onLoadZoltarQuestions = mock(async () => undefined)
		const renderedComponent = await renderIntoDocument(h(ForkZoltarSection, createProps({ hasLoadedZoltarQuestions: false, onLoadZoltarQuestions, zoltarQuestions: [] })))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(onLoadZoltarQuestions).toHaveBeenCalledTimes(1)
	})

	test('explains an empty picker when no question has ended', async () => {
		const renderedComponent = await renderIntoDocument(h(ForkZoltarSection, createProps({ currentTimestamp: 10n })))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(renderedComponent.container.textContent).toContain('No ended questions yet')
		expect(renderedComponent.container.querySelector('input[type="search"]')).toBeNull()
	})
})
