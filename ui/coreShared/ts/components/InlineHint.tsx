import * as commonCopy from '../copy/common.js'
import { LoadingAwareText } from './LoadingText.js'

type InlineHintProps = {
	ariaLabel?: string
	id?: string
	message: string
}

export function InlineHint({ ariaLabel = commonCopy.moreInfo, id, message }: InlineHintProps) {
	return (
		<div aria-label={ariaLabel} className='tx-action-notice' id={id} role='note'>
			<LoadingAwareText>{message}</LoadingAwareText>
		</div>
	)
}
