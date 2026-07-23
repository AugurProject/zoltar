import type { ComponentChildren } from 'preact'
import { LoadingAwareText, LoadingText } from './LoadingText.js'
import type { UserMessagePresentation } from '../lib/userCopy.js'

type StateHintProps = {
	actions?: ComponentChildren
	className?: string
	presentation: UserMessagePresentation
	title?: ComponentChildren
}

export function StateHint({ actions, className = '', presentation, title }: StateHintProps) {
	const hasVisibleCopy = title !== undefined || presentation.detail !== undefined || presentation.actionHint !== undefined || actions !== undefined
	const fallbackTitle = hasVisibleCopy ? undefined : presentation.badgeLabel

	return (
		<div className={`state-hint ${className}`.trim()}>
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
