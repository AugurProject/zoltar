import * as commonCopy from '../copy/common.js'
import { useEffect, useState } from 'preact/hooks'
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

	return (
		<div id={id} className={`notice error${isCloseable ? ' closeable' : ''}`} role='alert' aria-live='assertive' aria-atomic='true'>
			{isCloseable ? (
				<button type='button' className='notice-dismiss' aria-label={commonCopy.dismissErrorActionLabel} onClick={() => setDismissed(true)}>
					<span className='notice-dismiss-icon' aria-hidden='true' />
				</button>
			) : undefined}
			<p>{message}</p>
		</div>
	)
}
