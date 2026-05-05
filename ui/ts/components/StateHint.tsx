import type { ComponentChildren } from 'preact'
import { LoadingText } from './LoadingText.js'
import type { UserMessagePresentation } from '../lib/userCopy.js'

type StateHintProps = {
	actions?: ComponentChildren
	className?: string
	presentation: UserMessagePresentation
	title?: ComponentChildren
}

export function StateHint({ actions, className = '', presentation, title }: StateHintProps) {
	return (
		<div className={`state-hint ${className}`.trim()}>
			{title === undefined ? undefined : <h3>{title}</h3>}
			{presentation.detail === undefined ? undefined : <p className='detail'>{presentation.detailIsLoading ? <LoadingText>{presentation.detail}</LoadingText> : presentation.detail}</p>}
			{presentation.actionHint === undefined ? undefined : <p className='detail'>{presentation.actionHint}</p>}
			{actions === undefined ? undefined : <div className='actions state-hint-actions'>{actions}</div>}
		</div>
	)
}
