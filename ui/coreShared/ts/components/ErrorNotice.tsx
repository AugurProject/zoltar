import * as commonCopy from '../copy/common.js'
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

	return <UserMessage id={id} placement='page' tone='error' announcement='assertive' detail={message} dismiss={isCloseable ? { label: commonCopy.dismissErrorActionLabel, onDismiss: () => setDismissed(true) } : undefined} />
}
