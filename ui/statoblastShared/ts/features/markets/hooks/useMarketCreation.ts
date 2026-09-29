import { useQuestionCreation } from '@zoltar/ui-zoltar-shared/features/questions/hooks/useQuestionCreation.js'
import type { UseQuestionCreationDependencies, UseQuestionCreationParameters } from '@zoltar/ui-zoltar-shared/features/questions/hooks/useQuestionCreation.js'

export type UseMarketCreationDependencies = {
	createMarket: UseQuestionCreationDependencies['createQuestion']
}

// Security pools only accept binary questions, and each universe keeps its own draft.
export function useMarketCreation(parameters: UseQuestionCreationParameters, dependencies?: UseMarketCreationDependencies) {
	const { createQuestion, questionCreating, questionError, questionFeedback, questionForm, questionResult, resetQuestion, setQuestionForm, ...zoltar } = useQuestionCreation(parameters, dependencies === undefined ? undefined : { createQuestion: dependencies.createMarket }, {
		fixedMarketType: 'binary',
		universeScoped: true,
	})
	return {
		...zoltar,
		createMarket: createQuestion,
		marketCreating: questionCreating,
		marketError: questionError,
		marketFeedback: questionFeedback,
		marketForm: questionForm,
		marketResult: questionResult,
		resetMarket: resetQuestion,
		setMarketForm: setQuestionForm,
	}
}
