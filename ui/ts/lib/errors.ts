const closeableErrorPatterns = ['user rejected the request', 'user rejected request', 'user denied transaction signature', 'user denied message signature', 'user denied account authorization']

export function getErrorDetail(error: unknown) {
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

	return detail
}

export function getErrorMessage(error: unknown, fallbackMessage: string) {
	const detail = getErrorDetail(error)
	return detail === undefined || detail === '' ? fallbackMessage : `${fallbackMessage}: ${detail}`
}

export function isCloseableErrorMessage(message: string | undefined) {
	if (message === undefined) return false

	const normalizedMessage = message.toLowerCase()
	if (normalizedMessage.includes('"code":4001') || normalizedMessage.includes("'code':4001") || normalizedMessage.includes('code 4001')) return true

	return closeableErrorPatterns.some(pattern => normalizedMessage.includes(pattern))
}
