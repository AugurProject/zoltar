import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import * as marketCopy from '../../../copy/market.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import { formatCurrencyBalance, formatRelativeTimestamp, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'

export type ForkChecklistStepKey = 'question' | 'rep' | 'approval' | 'review'
export type ForkChecklistStepStatus = 'done' | 'blocked' | 'pending'
export type ForkChecklistStep = {
	key: ForkChecklistStepKey
	reason: string
	status: ForkChecklistStepStatus
}

/** The question-selection state the fork form resolves before the checklist runs. */
export type ForkQuestionSelection = { kind: 'none' } | { kind: 'loading' } | { kind: 'unavailable'; reason: string } | { kind: 'selected'; question: Pick<MarketDetails, 'endTime' | 'exists'> }

export type ForkChecklistInput = {
	/** Problem that blocks every fork transaction, such as a disconnected wallet or unloaded universe. Steps whose data it withholds wait on it; the review step reports it. */
	blockingReason: string | undefined
	currentTimestamp: bigint | undefined
	/** Burn and migration-credit terms are known, so the submission can be previewed. */
	hasForkEconomics: boolean
	forkThresholdAttoRep: bigint | undefined
	question: ForkQuestionSelection
	repBalanceAttoRep: bigint | undefined
	/** Genesis REP needs an ERC-20 approval; child-universe REP is burned directly by Zoltar. */
	requiresApproval: boolean
	approvedAttoRep: bigint | undefined
	approvalLoading: boolean
	/** Symbol of the universe's REP token, such as `REP` or `REP7`. */
	tokenSymbol: string
}

export type ForkChecklist = {
	/** The step whose reason explains why the fork cannot be submitted yet; undefined once it can be submitted. */
	blockingStepKey: ForkChecklistStepKey | undefined
	/** The fork transaction can be submitted: every prerequisite step is done. */
	canSubmit: boolean
	steps: readonly [ForkChecklistStep, ForkChecklistStep, ForkChecklistStep, ForkChecklistStep]
	/** Why the fork cannot be submitted yet, from the first unfinished step; undefined once it can be submitted. */
	submitBlockedReason: string | undefined
}

/**
 * Zoltar lets any existing question whose end time has passed force a fork of an unforked universe
 * (`Zoltar._forkUniverse`: the question must exist and `block.timestamp >= endTime`). Finalization and
 * universe binding are not checked on-chain.
 */
function isQuestionEligibleForFork(question: Pick<MarketDetails, 'endTime' | 'exists'>, currentTimestamp: bigint | undefined) {
	if (currentTimestamp === undefined) return undefined
	return question.exists && currentTimestamp >= question.endTime
}

/** The 'Use for fork' shortcut on a question: offered only once the question can fork the universe. */
export function resolveUseForForkAction(hasForked: boolean, question: Pick<MarketDetails, 'endTime' | 'exists'> | undefined, currentTimestamp: bigint | undefined) {
	if (hasForked) return { disabled: true, label: marketCopy.alreadyForked, kind: 'forked' as const }
	const eligible = question === undefined ? undefined : isQuestionEligibleForFork(question, currentTimestamp)
	if (eligible === true) return { disabled: false, label: marketCopy.useForFork, kind: 'available' as const }
	if (eligible === false && question?.exists === true) return { disabled: true, label: marketCopy.forkAfterEnd, kind: 'notEnded' as const }
	// Chain time or the question details are not loaded yet (or failed to load), so eligibility cannot be shown.
	return { disabled: true, label: marketCopy.forkEligibilityUnknown, kind: 'unknown' as const }
}

/** Eligible questions matching the search text, most recently ended first. */
export function getForkEligibleQuestions(questions: readonly MarketDetails[], currentTimestamp: bigint | undefined, searchText = '') {
	const normalizedSearchText = searchText.trim().toLowerCase()
	return questions
		.filter(question => isQuestionEligibleForFork(question, currentTimestamp) === true)
		.filter(question => normalizedSearchText === '' || question.title.toLowerCase().includes(normalizedSearchText) || question.questionId.toLowerCase().includes(normalizedSearchText))
		.sort((left, right) => {
			if (left.endTime === right.endTime) return 0
			return left.endTime > right.endTime ? -1 : 1
		})
}

function deriveQuestionStep(question: ForkQuestionSelection, currentTimestamp: bigint | undefined): ForkChecklistStep {
	switch (question.kind) {
		case 'none':
			return { key: 'question', reason: zoltarCopy.forkQuestionRequiredReason, status: 'pending' }
		case 'loading':
			return { key: 'question', reason: zoltarCopy.forkQuestionLoadingReason, status: 'pending' }
		case 'unavailable':
			return { key: 'question', reason: question.reason, status: 'blocked' }
		case 'selected': {
			const { endTime } = question.question
			if (currentTimestamp === undefined) return { key: 'question', reason: zoltarCopy.forkQuestionTimeLoadingReason, status: 'pending' }
			if (isQuestionEligibleForFork(question.question, currentTimestamp) !== true) return { key: 'question', reason: zoltarCopy.formatForkQuestionActiveReason(formatTimestamp(endTime), formatRelativeTimestamp(endTime, currentTimestamp)), status: 'blocked' }
			return { key: 'question', reason: zoltarCopy.forkQuestionEndedReason, status: 'done' }
		}
		default:
			return assertNever(question)
	}
}

function deriveRepStep({ forkThresholdAttoRep, repBalanceAttoRep, tokenSymbol, blockingReason }: ForkChecklistInput): ForkChecklistStep {
	if (forkThresholdAttoRep === undefined || repBalanceAttoRep === undefined) return { key: 'rep', reason: blockingReason === undefined ? zoltarCopy.forkRepBalanceLoadingReason : zoltarCopy.forkStepWaitingReason, status: 'pending' }
	const balance = formatCurrencyBalance(repBalanceAttoRep)
	const threshold = formatCurrencyBalance(forkThresholdAttoRep)
	if (repBalanceAttoRep < forkThresholdAttoRep) return { key: 'rep', reason: zoltarCopy.formatForkRepShortfall(balance, threshold, formatCurrencyBalance(forkThresholdAttoRep - repBalanceAttoRep), tokenSymbol), status: 'blocked' }
	return { key: 'rep', reason: zoltarCopy.formatForkRepSufficient(balance, threshold, tokenSymbol), status: 'done' }
}

function deriveApprovalStep({ approvalLoading, approvedAttoRep, forkThresholdAttoRep, requiresApproval, tokenSymbol, blockingReason }: ForkChecklistInput): ForkChecklistStep {
	if (!requiresApproval) return { key: 'approval', reason: zoltarCopy.forkApprovalNotRequired, status: 'done' }
	if (forkThresholdAttoRep === undefined || approvedAttoRep === undefined || approvalLoading) return { key: 'approval', reason: blockingReason === undefined ? zoltarCopy.forkApprovalLoadingReason : zoltarCopy.forkStepWaitingReason, status: 'pending' }
	const threshold = formatCurrencyBalance(forkThresholdAttoRep)
	if (approvedAttoRep < forkThresholdAttoRep) return { key: 'approval', reason: zoltarCopy.formatForkApprovalRequired(formatCurrencyBalance(approvedAttoRep), threshold, tokenSymbol), status: 'pending' }
	return { key: 'approval', reason: zoltarCopy.formatForkApprovalSufficient(threshold, tokenSymbol), status: 'done' }
}

/** Resolves the fork prerequisites in order: an ended question, enough REP, enough approval, then review and submit. */
export function deriveForkChecklist(input: ForkChecklistInput): ForkChecklist {
	const questionStep = deriveQuestionStep(input.question, input.currentTimestamp)
	const repStep = deriveRepStep(input)
	const approvalStep = deriveApprovalStep(input)
	const prerequisites = [questionStep, repStep, approvalStep]
	const firstUnfinished = prerequisites.find(step => step.status !== 'done')
	// A wallet, network, or universe problem and missing fork terms belong to the review step; otherwise the first unfinished step owns the blocker.
	const reviewBlocker = (() => {
		if (input.blockingReason !== undefined) return input.blockingReason
		if (firstUnfinished === undefined && !input.hasForkEconomics) return zoltarCopy.forkEconomicsUnavailableReason
		return undefined
	})()
	const reviewStep: ForkChecklistStep = (() => {
		if (reviewBlocker !== undefined) return { key: 'review', reason: reviewBlocker, status: 'blocked' }
		if (firstUnfinished !== undefined) return { key: 'review', reason: zoltarCopy.forkReviewWaiting, status: 'blocked' }
		return { key: 'review', reason: zoltarCopy.forkReviewReady, status: 'pending' }
	})()
	const blockingStep = reviewBlocker === undefined ? firstUnfinished : reviewStep
	return {
		blockingStepKey: blockingStep?.key,
		canSubmit: blockingStep === undefined,
		steps: [questionStep, repStep, approvalStep, reviewStep],
		submitBlockedReason: blockingStep?.reason,
	}
}
