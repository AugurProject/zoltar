export const transactionErrorMessages = {
	fullGasLimit: 'Transaction failed after using its full gas limit. Open the transaction details before retrying.',
	canceledOrReplaced: 'Transaction canceled or replaced.',
	confirmationUnavailable: 'Could not confirm the transaction. Check its status before retrying.',
	insufficientApproval: 'Approval confirmed, but it is below the report requirement. Review funding again to approve the required total before continuing.',
	reviewCanceled: 'Remaining transactions canceled. Transactions already sent are unchanged.',
}

/** True when the user closed or backed out of a transaction review, which is a cancellation rather than a failure. */
export function isTransactionReviewCancellation(error: unknown) {
	return collectErrorDetails(error).some(detail => detail === transactionErrorMessages.reviewCanceled)
}

function isTransactionErrorMessage(message: string | undefined) {
	return message !== undefined && Object.values(transactionErrorMessages).includes(message)
}

const closeableErrorPatterns = ['user rejected the request', 'user rejected request', 'user denied transaction signature', 'user denied message signature', 'user denied account authorization', 'action canceled in wallet']
const technicalWriteErrorPatterns = ['allowance', 'balance', 'call reverted', 'connector', 'erc20', 'estimategas', 'execution reverted', 'fee', 'gas', 'insufficient funds', 'internal json-rpc', 'json-rpc', 'network', 'nonce', 'replacement transaction', 'reverted', 'rpc', 'transaction', 'transfer', 'underpriced']

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

export function hasErrorCode(value: unknown): value is { code: number | string } {
	return isObjectRecord(value) && (typeof value['code'] === 'number' || typeof value['code'] === 'string')
}

export function hasErrorMessage(value: unknown): value is { message: string } {
	return isObjectRecord(value) && typeof value['message'] === 'string'
}

const ignorableLogDecodeErrorNames = ['AbiEventSignatureNotFoundError', 'DecodeLogDataMismatch', 'DecodeLogTopicsMismatch']

export function isIgnorableLogDecodeError(error: unknown) {
	return error instanceof Error && ignorableLogDecodeErrorNames.includes(error.name)
}

const recoverableContractReadErrorNames = ['CallExecutionError', 'ContractFunctionExecutionError', 'ContractFunctionRevertedError', 'HttpRequestError', 'InvalidAddressError', 'RpcError', 'RpcRequestError', 'TimeoutError', 'UnknownNodeError']
const recoverableContractReadPatterns = ['abi', 'call reverted', 'contract function', 'execution reverted', 'internal json-rpc', 'json-rpc', 'network', 'no data', 'returned no data', 'rpc', 'should not be used', 'symbol']

export function isRecoverableContractReadError(error: unknown) {
	if (!(error instanceof Error)) return false
	if (recoverableContractReadErrorNames.includes(error.name)) return true
	const normalizedMessage = error.message.toLowerCase()
	return recoverableContractReadPatterns.some(pattern => normalizedMessage.includes(pattern))
}

const recoverableQuoteErrorPatterns = ['mock pricing', 'no uniswap', 'pool', 'quote', 'quoter', 'simulation mode', 'uniswap']

export function isRecoverableQuoteError(error: unknown) {
	if (isRecoverableContractReadError(error)) return true
	return error instanceof Error && recoverableQuoteErrorPatterns.some(pattern => error.message.toLowerCase().includes(pattern))
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
	if (cause !== undefined) details.push(...collectErrorDetails(cause, seen))

	if (details.length > 0) return details

	try {
		const serialized = JSON.stringify(error)
		return serialized === undefined ? [] : [serialized]
	} catch (error) {
		if (!(error instanceof TypeError)) throw error
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

/** Library diagnostics such as tevm's `Docs:`, `Details:`, and `Version:` trailers add nothing a user can act on. */
function stripDiagnosticTrailers(detail: string) {
	return detail
		.replace(/\s*\bDocs:\s*https?:\/\/\S+/gi, '')
		.replace(/\s*\bDetails:\s*(\{.*?\}|\[.*?\]|[^{}[\]]*?)(?=\s*\bVersion:|$)/gi, '')
		.replace(/\s*\bVersion:\s*\S+/gi, '')
}

function stripErrorWrappers(detail: string) {
	let sanitized = stripDiagnosticTrailers(detail)
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
	return comparable === '' || comparable === '[object object]' || comparable === 'unknown error' || comparable === 'for an unknown reason' || comparable === 'revert'
}

function getKnownTransactionErrorDetail(details: string[]) {
	for (const detail of details) {
		const message = Object.values(transactionErrorMessages).find(candidate => normalizeComparableMessage(candidate) === normalizeComparableMessage(detail))
		if (message !== undefined) return message
	}
	for (const detail of details) {
		if (detail.toLowerCase().includes('stale price')) return "The pool's oracle price expired. Request a new price in Price Oracle, then retry."
	}
	return undefined
}

function getContractNoDataDetail(value: string) {
	const normalized = value.toLowerCase()
	if (!normalized.includes('returned no data') && !normalized.includes('no data')) return undefined
	if (!normalized.includes('contract function') && !normalized.includes('0x')) return undefined

	return 'No contract data was returned. Check that the selected network or simulation scenario has deployed contracts, then refresh.'
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
	const contractNoDataDetail = getContractNoDataDetail(sanitized)
	if (contractNoDataDetail !== undefined) return contractNoDataDetail

	const maxLength = 160
	return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength - 3).trimEnd()}...` : sanitized
}

export function getErrorDetail(error: unknown, fallbackMessage?: string) {
	const details = collectErrorDetails(error)
	const knownTransactionErrorDetail = getKnownTransactionErrorDetail(details)
	if (knownTransactionErrorDetail !== undefined) return knownTransactionErrorDetail
	for (const detail of details) {
		const sanitized = sanitizeErrorDetail(detail, fallbackMessage)
		if (sanitized !== undefined) return sanitized
	}

	return undefined
}

export function isWalletRejection(error: unknown, seen = new Set<object>()): boolean {
	if (isObjectRecord(error)) {
		if (seen.has(error)) return false
		seen.add(error)
		if (error['code'] === 4001 || error['code'] === '4001') return true
		if (isWalletRejection(error['cause'], seen)) return true
	}
	return collectErrorDetails(error).some(detail => isCloseableErrorMessage(detail))
}

function appendReason(fallbackMessage: string, detail: string | undefined) {
	if (detail === undefined) return fallbackMessage
	return `${ensureSentence(fallbackMessage)} Reason: ${detail}`
}

function rewriteWriteFallbackMessage(fallbackMessage: string) {
	const normalizedFallback = normalizeWhitespace(fallbackMessage)
	if (!normalizedFallback.toLowerCase().startsWith('failed to ')) return `Transaction failed. ${normalizedFallback}`

	const action = normalizedFallback.slice('Failed to '.length)
	return `Transaction failed while attempting to ${action}`
}

export function formatWriteErrorMessage(error: unknown, fallbackMessage: string) {
	if (isWalletRejection(error)) return 'Action canceled in wallet.'

	const detail = getErrorDetail(error, fallbackMessage)
	if (detail !== undefined && (isTransactionErrorMessage(detail) || shouldUseStandaloneWriteMessage(detail))) return detail
	const rewrittenFallback = rewriteWriteFallbackMessage(fallbackMessage)
	return detail === undefined ? ensureSentence(rewrittenFallback) : appendReason(rewrittenFallback, detail)
}

export function formatRefreshErrorMessage(error: unknown, fallbackMessage: string) {
	if (isWalletRejection(error)) return 'Action canceled in wallet.'
	return appendReason(fallbackMessage, getErrorDetail(error, fallbackMessage))
}

export function getErrorMessage(error: unknown, fallbackMessage: string) {
	if (isWalletRejection(error)) return 'Action canceled in wallet.'
	const detail = getErrorDetail(error, fallbackMessage)
	if (detail !== undefined && isTransactionErrorMessage(detail)) return detail
	return appendReason(fallbackMessage, detail)
}

export function isCloseableErrorMessage(message: string | undefined) {
	if (message === undefined) return false

	const normalizedMessage = message.toLowerCase()
	if (normalizedMessage.includes('"code":4001') || normalizedMessage.includes("'code':4001") || normalizedMessage.includes('code 4001')) return true

	return closeableErrorPatterns.some(pattern => normalizedMessage.includes(pattern))
}
