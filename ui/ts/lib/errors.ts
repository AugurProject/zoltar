export function getErrorMessage(error: unknown, fallbackMessage: string) {
	let detail: string | undefined

	if (error instanceof Error) {
		detail = typeof error.message === 'string' ? error.message.trim() : String(error.message).trim()
	} else if (typeof error === 'string') {
		detail = error.trim()
	} else {
		try {
			detail = JSON.stringify(error) ?? undefined
		} catch {
			detail = undefined
		}
	}

	return detail === undefined || detail === '' ? fallbackMessage : `${ fallbackMessage }: ${ detail }`
}
