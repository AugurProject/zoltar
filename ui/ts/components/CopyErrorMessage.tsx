type CopyErrorMessageProps = {
	id: string
	message: string | undefined
}

export function CopyErrorMessage({ id, message }: CopyErrorMessageProps) {
	if (message === undefined) return undefined

	return (
		<span className='copy-error-message' id={id} role='alert' aria-live='assertive'>
			{message}
		</span>
	)
}
