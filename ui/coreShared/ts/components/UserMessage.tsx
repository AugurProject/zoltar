import type { ComponentChildren } from 'preact'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { LoadingText } from './LoadingText.js'

export type UserMessageTone = 'neutral' | 'warning' | 'error' | 'success'
type UserMessagePlacement = 'field' | 'inline' | 'section' | 'page'

type UserMessageContent = {
	title?: ComponentChildren
	detail?: ComponentChildren
	actionHint?: ComponentChildren
	actions?: ComponentChildren
	expandableDetail?: { label: string; content: ComponentChildren } | undefined
}

type MessageOptions = {
	announcement?: 'assertive' | 'polite' | undefined
	ariaLabel?: string
	className?: string
	id?: string | undefined
	loading?: boolean
	tone?: UserMessageTone
}

type UserMessageProps = MessageOptions &
	(
		| { placement: 'field'; as?: 'p' | 'span'; detail: ComponentChildren; title?: never; actionHint?: never; actions?: never; expandableDetail?: never; dismiss?: never }
		| (UserMessageContent & { placement?: Exclude<UserMessagePlacement, 'field' | 'page'>; dismiss?: never; as?: never })
		| (UserMessageContent & { placement: 'page'; dismiss?: { label: string; onDismiss(): void } | undefined; as?: never })
	)

/** Tone describes meaning, placement controls hierarchy, and announcement is explicitly opt-in. */
export function UserMessage({ actions, actionHint, as: FieldTag = 'p', announcement, ariaLabel, className = '', detail, dismiss, expandableDetail, id, loading = false, placement = 'inline', title, tone = 'neutral' }: UserMessageProps) {
	let role: 'alert' | 'status' | 'note' | undefined
	if (announcement === 'assertive') role = 'alert'
	else if (announcement === 'polite') role = 'status'
	else if (placement === 'inline') role = 'note'
	const attributes = {
		'aria-atomic': announcement === undefined ? undefined : ('true' as const),
		'aria-label': ariaLabel,
		'aria-live': announcement,
		'data-message-placement': placement,
		'data-message-tone': tone,
		id,
		role,
	}
	// Routine amount prerequisites stay available to described controls without adding visible form notices.
	const isAmountPrerequisite = typeof detail === 'string' && (/^Enter .+ (?:amount|price) greater than zero\.$/.test(detail) || /^(?:Base|Quote) token amount must be greater than zero\.$/.test(detail) || detail === 'Enter an amount first.')
	if (isAmountPrerequisite && title === undefined && actionHint === undefined && actions === undefined && expandableDetail === undefined && dismiss === undefined && !loading) {
		return (
			<span {...attributes} className='visually-hidden'>
				{detail}
			</span>
		)
	}
	const detailContent = loading ? <LoadingText announce={announcement === undefined}>{detail}</LoadingText> : detail
	if (placement === 'field')
		return (
			<FieldTag {...attributes} className={`${tone === 'error' ? 'field-error' : 'field-hint'} ${className}`.trim()}>
				{detailContent}
			</FieldTag>
		)
	let placementClass = 'notice notice-stack-item'
	if (placement === 'inline') placementClass = 'tx-action-notice'
	if (placement === 'section') placementClass = 'state-hint'
	const classes = [placementClass, tone === 'neutral' ? undefined : tone, dismiss === undefined ? undefined : 'closeable', className].filter(Boolean).join(' ')
	let heading: ComponentChildren
	if (title !== undefined) heading = placement === 'section' ? <h3>{title}</h3> : <strong className='notice-title'>{title}</strong>
	let body: ComponentChildren
	if (detail !== undefined) {
		body = placement === 'section' ? <p className='detail'>{detailContent}</p> : <div>{detailContent}</div>
		if (placement === 'inline') body = detailContent
	}
	return (
		<div {...attributes} className={classes}>
			{dismiss === undefined ? undefined : (
				<button type='button' className='notice-dismiss' aria-label={dismiss.label} onClick={dismiss.onDismiss}>
					<span className='notice-dismiss-icon' aria-hidden='true' />
				</button>
			)}
			{heading}
			{body}
			{actionHint === undefined ? undefined : <p className='detail'>{actionHint}</p>}
			{expandableDetail === undefined ? undefined : <ReadOnlyDetailAccordion title={expandableDetail.label}>{expandableDetail.content}</ReadOnlyDetailAccordion>}
			{actions === undefined ? undefined : <div className={`actions${placement === 'section' ? ' state-hint-actions' : ''}`}>{actions}</div>}
		</div>
	)
}
