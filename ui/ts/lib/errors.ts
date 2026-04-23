const closeableErrorPatterns = ['user rejected the request', 'user rejected request', 'user denied transaction signature', 'user denied message signature', 'user denied account authorization', 'action canceled in wallet']

function readErrorDetail(error: unknown) {
	if (error instanceof Error) {
		return typeof error.message === 'string' ? error.message.trim() : String(error.message).trim()
	}
	if (typeof error === 'string') {
		return error.trim()
	}
	try {
		return JSON.stringify(error) ?? undefined
	} catch {
		return undefined
	}
}

export function getErrorDetail(error: unknown) {
	return readErrorDetail(error)
}

export function getErrorMessage(error: unknown, fallbackMessage: string) {
	const detail = readErrorDetail(error)
	if (detail === undefined || detail === '') return fallbackMessage
	if (isCloseableErrorMessage(detail)) return 'Action canceled in wallet.'
	return fallbackMessage
}

export function isCloseableErrorMessage(message: string | undefined) {
	if (message === undefined) return false

	const normalizedMessage = message.toLowerCase()
	if (normalizedMessage.includes('"code":4001') || normalizedMessage.includes("'code':4001") || normalizedMessage.includes('code 4001')) return true

	return closeableErrorPatterns.some(pattern => normalizedMessage.includes(pattern))
}
