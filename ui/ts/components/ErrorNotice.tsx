import { useEffect, useState } from 'preact/hooks'
import { isCloseableErrorMessage } from '../lib/errors.js'

type ErrorNoticeProps = {
	message: string | undefined
}

export function ErrorNotice({ message }: ErrorNoticeProps) {
	const [dismissed, setDismissed] = useState(false)
	const isCloseable = isCloseableErrorMessage(message)

	useEffect(() => {
		setDismissed(false)
	}, [message])

	if (message === undefined) return undefined
	if (isCloseable && dismissed) return undefined

	return (
		<div className={`notice error${isCloseable ? ' closeable' : ''}`}>
			{isCloseable ? (
				<button type='button' className='notice-dismiss' aria-label='Dismiss error' onClick={() => setDismissed(true)}>
					<span className='notice-dismiss-icon' aria-hidden='true' />
				</button>
			) : undefined}
			<p>{message}</p>
		</div>
	)
}
