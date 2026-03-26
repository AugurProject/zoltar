export function getErrorMessage(error: unknown, fallbackMessage: string) {
	if (error instanceof Error) {
		const detail = typeof error.message === 'string' ? error.message.trim() : String(error.message).trim()
		return detail === '' ? fallbackMessage : `${ fallbackMessage }: ${ detail }`
	}

	if (typeof error === 'string' && error.trim() !== '') {
		return `${ fallbackMessage }: ${ error }`
	}

	try {
		return `${ fallbackMessage }: ${ JSON.stringify(error) }`
	} catch {
		return fallbackMessage
	}
}
