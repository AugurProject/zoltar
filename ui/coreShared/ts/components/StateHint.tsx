import type { ComponentChildren } from 'preact'
import { UserMessage, type UserMessageTone } from './UserMessage.js'
import type { UserMessagePresentation } from '../lib/userCopy.js'

type StateHintProps = {
	actions?: ComponentChildren
	announcement?: 'assertive' | 'polite' | undefined
	className?: string
	id?: string | undefined
	presentation: UserMessagePresentation
	title?: ComponentChildren
}

export function StateHint({ actions, announcement, className = '', id, presentation, title }: StateHintProps) {
	const hasVisibleCopy = title !== undefined || presentation.detail !== undefined || presentation.actionHint !== undefined || actions !== undefined
	const fallbackTitle = hasVisibleCopy ? undefined : presentation.badgeLabel
	let tone: UserMessageTone = 'neutral'
	if (presentation.badgeTone === 'warning' || presentation.badgeTone === 'blocked') tone = 'warning'
	if (presentation.badgeTone === 'ok') tone = 'success'
	if (presentation.badgeTone === 'danger' || presentation.key === 'load_failed') tone = 'error'
	return <UserMessage tone={tone} id={id} announcement={announcement} className={className} placement='section' title={title ?? fallbackTitle} detail={presentation.detail} loading={presentation.detailIsLoading === true} actionHint={presentation.actionHint} actions={actions} />
}
