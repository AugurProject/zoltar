import type { ComponentChildren } from 'preact'
import type { Hash } from '@zoltar/shared/ethereum'

type ActionFeedbackStatus = {
	detail: ComponentChildren
	hash?: Hash
	title: ComponentChildren
	tone: 'pending' | 'success' | 'warning' | 'error'
}

export type ActionFeedback<TAction extends string> = {
	action: TAction
	status: ActionFeedbackStatus
}

export function createPendingActionFeedback<TAction extends string>(action: TAction, title: string, detail = 'Waiting for confirmation.'): ActionFeedback<TAction> {
	return {
		action,
		status: {
			detail,
			title,
			tone: 'pending',
		},
	}
}

export function createSuccessActionFeedback<TAction extends string>(action: TAction, title: string, hash: Hash, detail = 'Transaction confirmed.'): ActionFeedback<TAction> {
	return {
		action,
		status: {
			detail,
			hash,
			title,
			tone: 'success',
		},
	}
}

export function createWarningActionFeedback<TAction extends string>(action: TAction, title: string, detail: string, hash?: Hash): ActionFeedback<TAction> {
	return {
		action,
		status: {
			detail,
			...(hash === undefined ? {} : { hash }),
			title,
			tone: 'warning',
		},
	}
}

export function createErrorActionFeedback<TAction extends string>(action: TAction, title: string, detail: string): ActionFeedback<TAction> {
	return {
		action,
		status: {
			detail,
			title,
			tone: 'error',
		},
	}
}
