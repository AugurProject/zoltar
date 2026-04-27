import { LoadingText } from './LoadingText.js'
import type { UserMessagePresentation } from '../lib/userCopy.js'

type StateHintProps = {
	className?: string
	presentation: UserMessagePresentation
}

export function StateHint({ className = '', presentation }: StateHintProps) {
	return (
		<div className={`state-hint ${className}`.trim()}>
			{presentation.badgeLabel === undefined ? undefined : (
				<p className='detail'>
					<span className={`badge ${presentation.badgeTone ?? 'muted'}`}>{presentation.badgeLabel}</span>
				</p>
			)}
			{presentation.detail === undefined ? undefined : <p className='detail'>{presentation.detailIsLoading ? <LoadingText>{presentation.detail}</LoadingText> : presentation.detail}</p>}
			{presentation.actionHint === undefined ? undefined : <p className='detail'>{presentation.actionHint}</p>}
		</div>
	)
}
