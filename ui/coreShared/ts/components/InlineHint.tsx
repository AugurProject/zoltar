import * as commonCopy from '../copy/common.js'
import { LoadingAwareText } from './LoadingText.js'

type InlineHintProps = {
	ariaLabel?: string
	id?: string | undefined
	loading?: boolean
	message: string
	role?: 'alert' | 'note'
}

export function InlineHint({ ariaLabel = commonCopy.moreInfo, id, loading = false, message, role = 'note' }: InlineHintProps) {
	const liveAttributes = role === 'alert' ? { 'aria-atomic': 'true' as const, 'aria-live': 'assertive' as const } : {}
	return (
		<div {...liveAttributes} aria-label={ariaLabel} className={`tx-action-notice${role === 'alert' ? ' error' : ''}`} id={id} role={role}>
			<LoadingAwareText loading={loading}>{message}</LoadingAwareText>
		</div>
	)
}
