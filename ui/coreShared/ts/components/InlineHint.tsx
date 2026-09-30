import * as commonCopy from '../copy/common.js'
import { UserMessage } from './UserMessage.js'

type InlineHintProps = {
	ariaLabel?: string
	id?: string | undefined
	loading?: boolean
	message: string
	role?: 'alert' | 'note'
}

export function InlineHint({ ariaLabel = commonCopy.moreInfo, id, loading = false, message, role = 'note' }: InlineHintProps) {
	return <UserMessage ariaLabel={ariaLabel} id={id} loading={loading} detail={message} tone={role === 'alert' ? 'error' : 'neutral'} announcement={role === 'alert' ? 'assertive' : undefined} />
}
