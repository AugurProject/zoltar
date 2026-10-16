/// <reference types='bun-types' />

import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { useExistingQuestionCheck, type ExistingQuestionCheck, type UseExistingQuestionCheckDependencies } from '@zoltar/ui-zoltar-shared/features/questions/hooks/useExistingQuestionCheck.js'
import { createQuestionParameters } from '@zoltar/ui-zoltar-shared/features/questions/lib/questionCreation.js'
import type { MarketFormState } from '@zoltar/ui-zoltar-shared/types/app.js'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'

const validForm: MarketFormState = {
	answerUnit: '',
	categoricalOutcomes: ['', ''],
	description: 'Question context',
	endTime: '2000',
	marketType: 'binary',
	scalarIncrement: '1',
	scalarMax: '100',
	scalarMin: '0',
	startTime: '1000',
	title: 'Will this happen?',
}

const waitForLookup = async () => await act(async () => await new Promise(resolve => setTimeout(resolve, 350)))

describe('useExistingQuestionCheck', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
	})

	async function renderCheck(loadQuestion: UseExistingQuestionCheckDependencies['loadQuestion'], props: { enabled: boolean; form: MarketFormState }) {
		const results: (ExistingQuestionCheck | undefined)[] = []
		function Harness({ enabled, form }: { enabled: boolean; form: MarketFormState }) {
			results.push(useExistingQuestionCheck({ enabled, environmentRefreshKey: 0, form }, { loadQuestion }))
			return h('div', {})
		}
		const rendered = await renderIntoDocument(h(Harness, props))
		cleanupRendered = rendered.cleanup
		return { latest: () => results.at(-1), rerender: async (next: { enabled: boolean; form: MarketFormState }) => await act(() => render(h(Harness, next), rendered.container)) }
	}

	test('looks up the ID the valid draft would create and reports an existing question', async () => {
		const parameters = createQuestionParameters(validForm)
		const expectedQuestionId = getQuestionId(parameters.questionData, parameters.outcomeLabels)
		const existing = createMarketDetails({ title: validForm.title })
		const loadQuestion = mock(async (_questionId: bigint) => existing)
		const check = await renderCheck(loadQuestion, { enabled: true, form: validForm })
		expect(check.latest()).toEqual({ status: 'checking' })
		await waitForLookup()
		expect(loadQuestion).toHaveBeenCalledTimes(1)
		expect(loadQuestion.mock.calls[0]?.[0]).toBe(expectedQuestionId)
		expect(check.latest()).toEqual({ question: existing, status: 'existing' })
	})

	test('reports a new question as available and never reads for an invalid or disabled draft', async () => {
		const loadQuestion = mock(async (_questionId: bigint) => createMarketDetails({ exists: false }))
		const check = await renderCheck(loadQuestion, { enabled: true, form: { ...validForm, title: '' } })
		await waitForLookup()
		expect(check.latest()).toBeUndefined()
		await check.rerender({ enabled: false, form: validForm })
		await waitForLookup()
		expect(check.latest()).toBeUndefined()
		expect(loadQuestion).not.toHaveBeenCalled()
		await check.rerender({ enabled: true, form: validForm })
		await waitForLookup()
		expect(check.latest()).toEqual({ status: 'available' })
	})

	test('does not block creation when the lookup fails', async () => {
		const check = await renderCheck(
			mock(async () => {
				throw Object.assign(new Error('rpc unavailable'), { name: 'HttpRequestError' })
			}),
			{ enabled: true, form: validForm },
		)
		await waitForLookup()
		expect(check.latest()).toEqual({ status: 'unavailable' })
	})
})
