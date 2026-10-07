import { UserMessage } from './UserMessage.js'

type InlineHintProps = {
	id?: string | undefined
	loading?: boolean
	message: string
	role?: 'alert' | 'note'
}

/** A control's reason or hint. It carries no accessible name of its own, so a button that names it in aria-describedby reads its text. */
export function InlineHint({ id, loading = false, message, role = 'note' }: InlineHintProps) {
	return <UserMessage id={id} loading={loading} detail={message} tone={role === 'alert' ? 'error' : 'neutral'} announcement={role === 'alert' ? 'assertive' : undefined} />
}
