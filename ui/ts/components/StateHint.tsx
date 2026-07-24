import type { ComponentChildren } from 'preact'
import { LoadingAwareText, LoadingText } from './LoadingText.js'
import type { UserMessagePresentation } from '../lib/userCopy.js'

type StateHintProps = {
	actions?: ComponentChildren
	announcement?: 'assertive' | 'polite'
	className?: string
	presentation: UserMessagePresentation
	title?: ComponentChildren
}

export function StateHint({ actions, announcement, className = '', presentation, title }: StateHintProps) {
	const hasVisibleCopy = title !== undefined || presentation.detail !== undefined || presentation.actionHint !== undefined || actions !== undefined
	const fallbackTitle = hasVisibleCopy ? undefined : presentation.badgeLabel
	let announcementRole: 'alert' | 'status' | undefined
	if (announcement === 'assertive') announcementRole = 'alert'
	if (announcement === 'polite') announcementRole = 'status'

	return (
		<div aria-atomic={announcement === undefined ? undefined : 'true'} aria-live={announcement} className={`state-hint ${className}`.trim()} role={announcementRole}>
			{title === undefined ? undefined : <h3>{title}</h3>}
			{fallbackTitle === undefined ? undefined : <h3>{fallbackTitle}</h3>}
			{presentation.detail === undefined ? undefined : <p className='detail'>{presentation.detailIsLoading ? <LoadingText>{presentation.detail}</LoadingText> : <LoadingAwareText>{presentation.detail}</LoadingAwareText>}</p>}
			{presentation.actionHint === undefined ? undefined : (
				<p className='detail'>
					<LoadingAwareText>{presentation.actionHint}</LoadingAwareText>
				</p>
			)}
			{actions === undefined ? undefined : <div className='actions state-hint-actions'>{actions}</div>}
		</div>
	)
}
