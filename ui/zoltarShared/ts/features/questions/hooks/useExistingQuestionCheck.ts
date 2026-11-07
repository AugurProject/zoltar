import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { isRecoverableContractReadError } from '@zoltar/ui-core-shared/lib/errors.js'
import { withReadTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { loadMarketDetails } from '../../../protocol/zoltar.js'
import type { MarketFormState } from '../../../types/app.js'
import { createQuestionParameters, validateMarketForm } from '../lib/questionCreation.js'

/**
 * - `checking`: the draft's question ID is being looked up.
 * - `available`: no question with this ID exists yet.
 * - `existing`: the question already exists, so creating it again would revert.
 * - `unavailable`: the lookup failed; creation stays possible and the contract still rejects a duplicate.
 */
export type ExistingQuestionCheck = Readonly<{ status: 'available' | 'checking' | 'unavailable' }> | Readonly<{ question: MarketDetails; status: 'existing' }>

export type UseExistingQuestionCheckDependencies = {
	loadQuestion: (questionId: bigint) => Promise<MarketDetails>
}

const defaultUseExistingQuestionCheckDependencies: UseExistingQuestionCheckDependencies = {
	loadQuestion: async questionId => await withReadTimeout(loadMarketDetails(createConnectedReadClient(), questionId)),
}

const EXISTING_QUESTION_CHECK_DELAY_MILLISECONDS = 300

function getDraftQuestionId(form: MarketFormState) {
	if (!validateMarketForm(form).isValid) return undefined
	const { outcomeLabels, questionData } = createQuestionParameters(form)
	return getQuestionId(questionData, outcomeLabels)
}

/** Looks up the question a valid draft would create, so Create can be blocked before the contract would revert on a duplicate. */
export function useExistingQuestionCheck({ enabled, environmentRefreshKey, form }: { enabled: boolean; environmentRefreshKey: number; form: MarketFormState }, dependencies: UseExistingQuestionCheckDependencies = defaultUseExistingQuestionCheckDependencies): ExistingQuestionCheck | undefined {
	const result = useSignal<{ key: string; value: ExistingQuestionCheck } | undefined>(undefined)
	const nextCheck = useRequestGuard()
	const questionId = enabled ? getDraftQuestionId(form) : undefined
	const key = questionId === undefined ? undefined : `${environmentRefreshKey.toString()}:${questionId.toString()}`
	useEffect(() => {
		const isCurrent = nextCheck()
		if (questionId === undefined || key === undefined) return
		// Each edit restarts the wait, so typing does not send a read per keystroke.
		const timeout = setTimeout(() => {
			void dependencies.loadQuestion(questionId).then(
				question => {
					if (isCurrent()) result.value = { key, value: question.exists ? { question, status: 'existing' } : { status: 'available' } }
				},
				(error: unknown) => {
					// A failed lookup never blocks creation; the contract still rejects a duplicate.
					if (!isRecoverableContractReadError(error)) console.error('[zoltar-question] existing question lookup failed', error)
					if (isCurrent()) result.value = { key, value: { status: 'unavailable' } }
				},
			)
		}, EXISTING_QUESTION_CHECK_DELAY_MILLISECONDS)
		return () => clearTimeout(timeout)
	}, [key])
	if (key === undefined) return undefined
	return result.value?.key === key ? result.value.value : { status: 'checking' }
}
