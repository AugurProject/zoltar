import * as appCopy from '../copy/app.js'
import { useEffect, useState } from 'preact/hooks'
import { UserMessage } from './UserMessage.js'
import { isCloseableErrorMessage } from '../lib/errors.js'

type ErrorNoticeProps = {
	id?: string
	message: string | undefined
}

export function ErrorNotice({ id, message }: ErrorNoticeProps) {
	const [dismissed, setDismissed] = useState(false)
	const isCloseable = isCloseableErrorMessage(message)

	useEffect(() => {
		setDismissed(false)
	}, [message])

	if (message === undefined) return undefined
	if (isCloseable && dismissed) return undefined

	// A closeable message is a wallet cancellation: the user declined, nothing was sent, so it is neutral and polite.
	if (isCloseable) return <UserMessage id={id} placement='page' tone='neutral' announcement='polite' detail={message} dismiss={{ label: appCopy.dismissNotice, onDismiss: () => setDismissed(true) }} />
	return <UserMessage id={id} placement='page' tone='error' announcement='assertive' detail={message} />
}
