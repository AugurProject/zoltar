import { UserMessage } from '../../components/UserMessage.js'
import { useRef, useState } from 'preact/hooks'
import * as appCopy from '../../copy/app.js'
import * as commonCopy from '../../copy/common.js'

type ApplicationErrorNoticeProps = {
	errorMessage: string
	onRetry: () => void | Promise<void>
}

export function ApplicationErrorNotice({ errorMessage, onRetry }: ApplicationErrorNoticeProps) {
	const retryInProgressRef = useRef(false)
	const [retryInProgress, setRetryInProgress] = useState(false)

	const retry = async () => {
		if (retryInProgressRef.current) return
		retryInProgressRef.current = true
		setRetryInProgress(true)
		try {
			await onRetry()
		} finally {
			retryInProgressRef.current = false
			setRetryInProgress(false)
		}
	}

	// The same frame and main landmark as the application, so the notice keeps the page's layout and landmarks.
	return (
		<div className='app-frame'>
			<main>
				<UserMessage
					placement='page'
					tone='error'
					announcement='assertive'
					detail={
						<>
							<h1>{appCopy.applicationErrorTitle}</h1>
							<p>{errorMessage}</p>
						</>
					}
					actions={
						<>
							<button type='button' disabled={retryInProgress} onClick={retry}>
								{retryInProgress ? commonCopy.retrying : commonCopy.retry}
							</button>
							<button type='button' className='secondary' onClick={() => window.location.reload()}>
								{appCopy.reloadApplication}
							</button>
						</>
					}
				/>
			</main>
		</div>
	)
}
