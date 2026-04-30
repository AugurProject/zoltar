const closeableErrorPatterns = ['user rejected the request', 'user rejected request', 'user denied transaction signature', 'user denied message signature', 'user denied account authorization', 'action canceled in wallet']
const technicalWriteErrorPatterns = ['allowance', 'balance', 'call reverted', 'connector', 'erc20', 'estimategas', 'execution reverted', 'fee', 'gas', 'insufficient funds', 'internal json-rpc', 'json-rpc', 'network', 'nonce', 'replacement transaction', 'reverted', 'rpc', 'transaction', 'transfer', 'underpriced']

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function normalizeWhitespace(value: string) {
	return value.trim().replace(/\s+/g, ' ')
}

function readStringValue(value: unknown) {
	return typeof value === 'string' ? normalizeWhitespace(value) : undefined
}

function readStringArrayValues(value: unknown) {
	if (!Array.isArray(value)) return []
	return value.flatMap(item => {
		const normalized = readStringValue(item)
		return normalized === undefined || normalized === '' ? [] : [normalized]
	})
}

function collectErrorDetails(error: unknown, seen = new Set<object>()): string[] {
	const stringValue = readStringValue(error)
	if (stringValue !== undefined && stringValue !== '') return [stringValue]

	if (Array.isArray(error)) return readStringArrayValues(error)
	if (!isObjectRecord(error)) return []
	if (seen.has(error)) return []

	seen.add(error)

	const details: string[] = []
	const shortMessage = readStringValue(error['shortMessage'])
	if (shortMessage !== undefined && shortMessage !== '') details.push(shortMessage)

	const nestedDetails = readStringValue(error['details'])
	if (nestedDetails !== undefined && nestedDetails !== '') details.push(nestedDetails)

	const message = readStringValue(error['message'])
	if (message !== undefined && message !== '') details.push(message)

	details.push(...readStringArrayValues(error['metaMessages']))

	const cause = error['cause']
	if (cause !== undefined) {
		details.push(...collectErrorDetails(cause, seen))
	}

	if (details.length > 0) return details

	try {
		const serialized = JSON.stringify(error)
		return serialized === undefined ? [] : [serialized]
	} catch {
		return []
	}
}

function normalizeComparableMessage(message: string) {
	return normalizeWhitespace(message)
		.replace(/[.!?]+$/, '')
		.toLowerCase()
}

function ensureSentence(message: string) {
	return /[.!?]$/.test(message) ? message : `${message}.`
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripMatchingPrefix(message: string, prefix: string | undefined) {
	if (prefix === undefined) return message
	const normalizedPrefix = normalizeWhitespace(prefix)
	if (normalizedPrefix === '') return message

	let stripped = message
	const prefixPattern = new RegExp(`^${escapeRegExp(normalizedPrefix)}(?::|\\.)?\\s*`, 'i')
	while (prefixPattern.test(stripped)) {
		stripped = stripped.replace(prefixPattern, '')
	}

	return stripped
}

function stripErrorWrappers(detail: string) {
	let sanitized = detail
	const wrapperPatterns = [/^(failed to [^:.]+[:.]\s*)+/i, /^(internal json-rpc error[.:]?\s*)+/i, /^(transaction execution reverted(?::)?\s*)+/i, /^(execution reverted(?::)?\s*)+/i, /^(call reverted(?::)?\s*)+/i, /^(reverted(?::)?\s*)+/i, /^(error:\s*)+/i]

	for (const pattern of wrapperPatterns) {
		sanitized = sanitized.replace(pattern, '')
	}

	return normalizeWhitespace(sanitized)
}

function isJsonOnlyValue(value: string) {
	return (value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))
}

function isGenericErrorDetail(value: string) {
	const comparable = normalizeComparableMessage(value)
	return comparable === '' || comparable === '[object object]' || comparable === 'unknown error' || comparable === 'for an unknown reason'
}

function shouldUseStandaloneWriteMessage(detail: string) {
	const firstCharacter = detail.charAt(0)
	if (firstCharacter === '') return false
	const normalized = detail.toLowerCase()
	if (technicalWriteErrorPatterns.some(pattern => normalized.includes(pattern))) return false
	return firstCharacter !== firstCharacter.toLowerCase()
}

export function sanitizeErrorDetail(detail: string | undefined, fallbackMessage?: string) {
	if (detail === undefined) return undefined

	let sanitized = normalizeWhitespace(detail)
	if (sanitized === '') return undefined
	sanitized = stripMatchingPrefix(sanitized, fallbackMessage)

	let previous = ''
	while (sanitized !== previous) {
		previous = sanitized
		sanitized = stripErrorWrappers(sanitized)
	}

	sanitized = sanitized.replace(/\.$/, '')
	if (sanitized === '' || isJsonOnlyValue(sanitized) || isGenericErrorDetail(sanitized)) return undefined
	if (fallbackMessage !== undefined && normalizeComparableMessage(sanitized) === normalizeComparableMessage(fallbackMessage)) return undefined

	const maxLength = 160
	return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength - 3).trimEnd()}...` : sanitized
}

export function getErrorDetail(error: unknown, fallbackMessage?: string) {
	for (const detail of collectErrorDetails(error)) {
		const sanitized = sanitizeErrorDetail(detail, fallbackMessage)
		if (sanitized !== undefined) return sanitized
	}

	return undefined
}

function getCloseableMessage(error: unknown) {
	return collectErrorDetails(error).find(detail => isCloseableErrorMessage(detail))
}

function appendReason(fallbackMessage: string, detail: string | undefined) {
	if (detail === undefined) return fallbackMessage
	return `${ensureSentence(fallbackMessage)} Reason: ${detail}`
}

function rewriteWriteFallbackMessage(fallbackMessage: string) {
	const normalizedFallback = normalizeWhitespace(fallbackMessage)
	if (!normalizedFallback.toLowerCase().startsWith('failed to ')) {
		return `Transaction failed. ${normalizedFallback}`
	}

	const action = normalizedFallback.slice('Failed to '.length)
	return `Transaction failed while attempting to ${action}`
}

export function formatWriteErrorMessage(error: unknown, fallbackMessage: string) {
	if (getCloseableMessage(error) !== undefined) return 'Action canceled in wallet.'

	const detail = getErrorDetail(error, fallbackMessage)
	if (detail !== undefined && shouldUseStandaloneWriteMessage(detail)) return detail
	const rewrittenFallback = rewriteWriteFallbackMessage(fallbackMessage)
	return detail === undefined ? ensureSentence(rewrittenFallback) : appendReason(rewrittenFallback, detail)
}

export function formatRefreshErrorMessage(error: unknown, fallbackMessage: string) {
	if (getCloseableMessage(error) !== undefined) return 'Action canceled in wallet.'
	return appendReason(fallbackMessage, getErrorDetail(error, fallbackMessage))
}

export function getErrorMessage(error: unknown, fallbackMessage: string) {
	if (getCloseableMessage(error) !== undefined) return 'Action canceled in wallet.'
	return appendReason(fallbackMessage, getErrorDetail(error, fallbackMessage))
}

export function isCloseableErrorMessage(message: string | undefined) {
	if (message === undefined) return false

	const normalizedMessage = message.toLowerCase()
	if (normalizedMessage.includes('"code":4001') || normalizedMessage.includes("'code':4001") || normalizedMessage.includes('code 4001')) return true

	return closeableErrorPatterns.some(pattern => normalizedMessage.includes(pattern))
}
