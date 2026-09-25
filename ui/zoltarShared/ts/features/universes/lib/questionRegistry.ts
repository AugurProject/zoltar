import { normalizeQuestionId } from '@zoltar/ui-core-shared/lib/questionId.js'
import type { MarketDetails, MarketDetailsPage } from '@zoltar/ui-core-shared/types/contracts.js'

export type LoadedQuestionRegistry = {
	questionCount: bigint | undefined
	questionPage: MarketDetailsPage | undefined
	questions: MarketDetails[]
}

function getQuestionKey(question: MarketDetails) {
	return normalizeQuestionId(question.questionId) ?? question.questionId.toLowerCase()
}

function replaceQuestion(questions: MarketDetails[], question: MarketDetails) {
	const questionKey = getQuestionKey(question)
	return questions.map(existingQuestion => (getQuestionKey(existingQuestion) === questionKey ? question : existingQuestion))
}

function includesQuestion(questions: readonly MarketDetails[], question: MarketDetails) {
	const questionKey = getQuestionKey(question)
	return questions.some(existingQuestion => getQuestionKey(existingQuestion) === questionKey)
}

/** Adds or replaces questions by normalized id, keeping the first-seen order. */
export function mergeQuestionLists(existingQuestions: MarketDetails[], nextQuestions: readonly MarketDetails[]) {
	const questionsById = new Map(existingQuestions.map(question => [getQuestionKey(question), question]))
	for (const question of nextQuestions) questionsById.set(getQuestionKey(question), question)
	return [...questionsById.values()]
}

/**
 * Places the newest registry entry into the loaded state without rereading the registry.
 * The registry appends questions, so the created question sits at index `questionCount - 1`;
 * it joins the loaded page only when that index directly follows the page's last loaded entry.
 */
export function insertCreatedQuestion(registry: LoadedQuestionRegistry, createdQuestion: MarketDetails, questionCount: bigint): LoadedQuestionRegistry {
	const questions = mergeQuestionLists(registry.questions, [createdQuestion])
	const page = registry.questionPage
	if (page === undefined) return { questionCount, questionPage: undefined, questions }
	if (includesQuestion(page.questions, createdQuestion)) return { questionCount, questionPage: { ...page, questionCount, questions: replaceQuestion(page.questions, createdQuestion) }, questions }
	const pageStart = BigInt(page.pageIndex) * BigInt(page.pageSize)
	const createdIndex = questionCount - 1n
	// Append only when the page ends exactly where the created question belongs; otherwise the next page read reconciles it.
	const createdFollowsPage = createdIndex < pageStart + BigInt(page.pageSize) && pageStart + BigInt(page.questions.length) === createdIndex
	const pageQuestions = createdFollowsPage ? [...page.questions, createdQuestion] : page.questions
	return { questionCount, questionPage: { ...page, questionCount, questions: pageQuestions }, questions }
}
