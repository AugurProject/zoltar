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

	return (
		<main>
			<section className='notice error' role='alert'>
				<h1>{appCopy.applicationErrorTitle}</h1>
				<p>{errorMessage}</p>
				<div className='actions'>
					<button type='button' disabled={retryInProgress} onClick={retry}>
						{retryInProgress ? commonCopy.retrying : commonCopy.retry}
					</button>
					<button type='button' className='secondary' onClick={() => window.location.reload()}>
						{appCopy.reloadApplication}
					</button>
				</div>
			</section>
		</main>
	)
}
