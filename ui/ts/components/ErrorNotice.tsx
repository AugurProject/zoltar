import { useEffect, useState } from 'preact/hooks'
import { isCloseableErrorMessage } from '../lib/errors.js'
import { TSX_STRINGS } from '../lib/uiStrings.js'

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
		<div className={`notice error${isCloseable ? ' closeable' : ''}`} role='alert' aria-live='assertive' aria-atomic='true'>
			{isCloseable ? (
				<button type='button' className='notice-dismiss' aria-label={TSX_STRINGS.componentsErrorNotice.copy001} onClick={() => setDismissed(true)}>
					<span className='notice-dismiss-icon' aria-hidden='true' />
				</button>
			) : undefined}
			<p>{message}</p>
		</div>
	)
}
