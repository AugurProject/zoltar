import * as commonCopy from '../copy/common.js'

type CopyErrorMessageProps = {
	id: string
	manualValue?: string
	message: string | undefined
}

export function CopyErrorMessage({ id, manualValue, message }: CopyErrorMessageProps) {
	if (message === undefined) return undefined

	return (
		<span className='copy-error-recovery'>
			<span className='copy-error-message' id={id} role='alert' aria-live='assertive'>
				{message}
			</span>
			{manualValue === undefined ? undefined : <input aria-label={commonCopy.manualCopyValue} className='copy-manual-value' onFocus={event => event.currentTarget.select()} readOnly type='text' value={manualValue} />}
		</span>
	)
}
