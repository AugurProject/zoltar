/** Operator-facing failure messages that redact URLs, secrets, and filesystem paths from raw errors. */
const GENERIC_PUBLIC_FAILURE = 'The operation returned an unexpected error. Automatic retry remains active; check protected bot logs for details.'

function publicFailureDetail(error: string, translateChainTerm = true) {
	const trimmed = error.trim()
	if (trimmed === '') return undefined
	const urlMatches = [...trimmed.matchAll(/(?![A-Za-z]:[\\/])\b[A-Za-z][A-Za-z0-9+.-]*:\S+/g)]
	let sanitized = trimmed
	for (const match of urlMatches.reverse()) {
		if (match.index === undefined) return undefined
		let replacement = '[redacted URL]'
		try {
			const url = new URL(match[0])
			if (url.protocol === 'http:' || url.protocol === 'https:') replacement = url.origin
		} catch (urlError) {
			void urlError
		}
		sanitized = `${sanitized.slice(0, match.index)}${replacement}${sanitized.slice(match.index + match[0].length)}`
	}
	sanitized = sanitized
		.replace(/(["']?(?:api(?:[_ -]?key)|auth(?:orization)?|bearer|credentials?|password|secret|token)["']?\s*[=:]\s*)"(?:\\.|[^"\\\r\n])*"/gi, '$1"[redacted]"')
		.replace(/(["']?(?:api(?:[_ -]?key)|auth(?:orization)?|bearer|credentials?|password|secret|token)["']?\s*[=:]\s*)'(?:\\.|[^'\\\r\n])*'/gi, "$1'[redacted]'")
		.replace(/(auth(?:orization)?\s*[=:]\s*)(?:(?:basic|bearer)\s+)?\S+/gi, '$1[redacted]')
		.replace(/(bearer\s+)\S+/gi, '$1[redacted]')
		.replace(/((?:api(?:[_ -]?key)|auth(?:orization)?|credentials?|password|secret|token)\s*[=:]\s*)\S+/gi, '$1[redacted]')
		.replace(/(["'])(?:[A-Za-z]:[\\/]|~?\/|\.\.?\/|\\\\)[^"'\r\n]*\1/g, '$1[protected path]$1')
		.replace(/(["'])(?![A-Za-z]+:\/\/)(?=[^"'\r\n]*[\\/])[^"'\r\n]*\1/gi, '$1[protected path]$1')
		.replace(/file:\/\/\S+/gi, '[protected path]')
		.replace(/(\b(?:file|path)\s*[=:]\s*)(?![A-Za-z]+:\/\/)(?=\S*[\\/])\S+/gi, '$1[protected path]')
		.replace(/(^|[\s'"(\[=])(?![A-Za-z]+:\/\/)(?=[^\s'"\)\]]*[\\/])[^\s'"\)\]]+/gi, '$1[protected path]')
		.replace(/(^|[\s'"(\[=])(?:[A-Za-z]:[\\/]|~?\/|\.\.?\/|\\\\)[^\s'"\)\]]+/g, '$1[protected path]')
		.replace(/(^|\s)(?!\S*[A-Za-z][A-Za-z0-9+.-]*:\/\/)(?=\S*[\\/])\S+/g, '$1[protected path]')
	if (translateChainTerm) sanitized = sanitized.replace(/canonical chain/gi, match => (match.startsWith('C') ? 'Blockchain history' : 'blockchain history'))
	const detail = sanitized.replace(/[.!?]+$/, '')
	const maximumLength = 320
	if (detail.length <= maximumLength) return detail
	const prefix = detail.slice(0, maximumLength - 1)
	const wordBoundary = prefix.lastIndexOf(' ')
	return `${(wordBoundary >= maximumLength * 0.75 ? prefix.slice(0, wordBoundary) : prefix).trimEnd()}…`
}

function attemptedOperationFailure(attempt: string, error: string, recovery: string) {
	const detail = publicFailureDetail(error)
	return `The bot tried to ${attempt}, but it failed${detail === undefined ? '' : `: ${detail}`}${detail?.endsWith('…') === true ? '' : '.'} ${recovery}`
}

function publicFailureCategory(error: string) {
	const normalized = (publicFailureDetail(error.replace(/https?:\/\/\S+/gi, '[url]'), false) ?? '').toLowerCase()
	if (/\b(?:risk|limits?|policy)\b/.test(normalized)) return { attempt: 'apply the active risk and execution limits', operatorRecovery: 'Review the active risk settings and protected bot logs.', pollRecovery: 'Automatic retry remains active. Review the active risk settings and protected bot logs.' }
	if (/\b(?:transactions?|receipts?|relays?)\b/.test(normalized)) return { attempt: 'submit or confirm a transaction', operatorRecovery: 'Review transaction activity while automatic retry remains active.', pollRecovery: 'Automatic retry remains active. Review transaction activity.' }
	if (/\b(?:markets?|prices?|quotes?)\b/.test(normalized)) return { attempt: 'collect and validate market prices', operatorRecovery: 'Automatic retry remains active.', pollRecovery: 'Automatic retry remains active.' }
	if (/\b(?:durable|history|persist(?:ed|ence|ent|ing)?)\b/.test(normalized)) return { attempt: 'save or reload durable operator state', operatorRecovery: 'Review recovery state before resuming execution.', pollRecovery: 'Automatic retry remains active. Review recovery state before resuming execution.' }
	if (/\b(?:rpc|chain|block(?:chain)?)\b/.test(normalized)) return { attempt: 'read blockchain data through an RPC endpoint', operatorRecovery: 'Automatic retry remains active.', pollRecovery: 'Automatic retry remains active.' }
	if (/\bstates?\b/.test(normalized)) return { attempt: 'save or reload durable operator state', operatorRecovery: 'Review recovery state before resuming execution.', pollRecovery: 'Automatic retry remains active. Review recovery state before resuming execution.' }
	return undefined
}

export function publicOperatorFailure(error: string, fallback = GENERIC_PUBLIC_FAILURE) {
	const category = publicFailureCategory(error)
	return category === undefined ? fallback : attemptedOperationFailure(category.attempt, error, category.operatorRecovery)
}

export function publicPollFailure(error: string, attempt?: string) {
	if (attempt !== undefined) return attemptedOperationFailure(attempt, error, 'Automatic retry remains active.')
	const category = publicFailureCategory(error)
	return category === undefined ? attemptedOperationFailure('complete the latest polling cycle', error, 'Automatic retry remains active.') : attemptedOperationFailure(category.attempt, error, category.pollRecovery)
}
