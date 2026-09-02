import { EndpointCheckFailure, type EndpointCheck } from '../monitoring/connectivity.ts'

const SHARED_VALIDATION_MESSAGES = new Set([
	'At least one public RPC URL is required',
	'At most 8 public RPC URLs are supported',
	'At most 8 read quorum RPC URLs are supported',
	'Connectivity settings must be a JSON object',
	'Connectivity settings require only readRpcUrl and publicRpcUrls',
	'Independent quorum RPC URLs must be an array of strings',
	'Invalid RPC URL',
	'Public RPC URLs must be an array of strings',
	'RPC URL must use HTTPS or HTTP on loopback, anvil, or reth',
	'RPC URLs must not contain embedded credentials',
	'RPC URLs must not contain fragments',
	'RPC URLs must not exceed 2048 characters',
	'Read RPC quorum must use independent origins; changing only the URL path does not create an independent provider',
	'Read RPC URL must be a string',
])

type RpcMethod = 'eth_callBundle' | 'eth_chainId' | 'eth_sendBundle' | 'eth_sendPrivateTransaction' | 'eth_sendRawTransaction'

function publicTarget(value: string) {
	try {
		return new URL(value).origin
	} catch (error) {
		void error
		return undefined
	}
}

function methodFailure(message: string) {
	const match = /^RPC (https?:\/\/[^ ]+) failed while calling (eth_callBundle|eth_chainId|eth_sendBundle|eth_sendPrivateTransaction|eth_sendRawTransaction): (.+)$/.exec(message)
	if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) return undefined
	const target = publicTarget(match[1])
	if (target === undefined) return undefined
	return { detail: match[3], method: match[2] as RpcMethod, target }
}

function safeTransportDetail(detail: string) {
	if (detail === 'The operation timed out.' || detail === 'fetch failed') return detail
	if (/^connection refused$/i.test(detail)) return 'connection refused'
	if (/^Unable to connect(?:\. Is the computer able to access the url\?)?$/i.test(detail) || /^network is unreachable$/i.test(detail)) return detail
	if (/^getaddrinfo (?:ENOTFOUND|EAI_AGAIN) [a-z0-9.-]+$/i.test(detail)) return detail
	return undefined
}

function localHostnameHint(target: string, detail: string) {
	if (safeTransportDetail(detail) === undefined) return ''
	try {
		const hostname = new URL(target).hostname
		if (hostname === 'reth' || hostname === 'anvil') return ` The hostname ${hostname} must resolve from the bot process; Docker service names like ${hostname} only work when the bot shares that container network.`
	} catch (error) {
		void error
	}
	return ''
}

function safeMethodFailure(target: string, method: RpcMethod, detail: string) {
	const transportDetail = safeTransportDetail(detail)
	if (transportDetail !== undefined) return `RPC ${target} failed while calling ${method}: ${transportDetail}${localHostnameHint(target, detail)}`
	const httpMatch = /(?:RPC returned HTTP|returned non-JSON HTTP|returned HTTP|: HTTP) (\d{3})/i.exec(detail)
	if (httpMatch?.[1] !== undefined && Number(httpMatch[1]) >= 400) return `RPC ${target} returned HTTP ${httpMatch[1]} while calling ${method}`
	if (method === 'eth_chainId') {
		if (detail === 'RPC returned an invalid chain id' || detail === 'RPC returned an unsupported chain id') return `RPC ${target} failed while calling eth_chainId: ${detail}`
		const chainMatch = /^Expected chain (\d+), received (\d+)$/.exec(detail)
		if (chainMatch?.[1] !== undefined && chainMatch[2] !== undefined) return `RPC ${target} failed while calling eth_chainId: Expected chain ${chainMatch[1]}, received ${chainMatch[2]}`
	}
	return undefined
}

function fallback(check: EndpointCheck, target: string, method: RpcMethod) {
	if (check.kind === 'private-relay') return `RPC ${target} failed while calling ${method}. Review the endpoint's private relay support and protected bot logs.`
	if (method === 'eth_sendRawTransaction') return `RPC ${target} failed while calling eth_sendRawTransaction. Review the endpoint's public transaction submission support and protected bot logs.`
	return `RPC ${target} failed while calling eth_chainId. Review the endpoint and protected bot logs.`
}

function checkFailure(check: EndpointCheck) {
	const target = publicTarget(check.target)
	if (target === undefined) return 'An RPC endpoint failed. Review the submitted endpoint and protected bot logs.'
	const parsed = check.error === undefined ? undefined : methodFailure(check.error)
	const method = parsed?.method ?? (check.kind === 'public-rpc' && check.chainId !== undefined ? 'eth_sendRawTransaction' : check.kind === 'private-relay' ? 'eth_sendPrivateTransaction' : 'eth_chainId')
	if (parsed !== undefined) return safeMethodFailure(parsed.target, method, parsed.detail) ?? fallback(check, target, method)
	if (check.error !== undefined) {
		const detail = check.error.startsWith(`${check.target}: `) ? check.error.slice(check.target.length + 2) : check.error
		const safe = safeMethodFailure(target, method, detail)
		if (safe !== undefined) return safe
	}
	return fallback(check, target, method)
}

export function publicConnectivityError(error: unknown, options: { fallback: string; validationMessages?: ReadonlySet<string> }) {
	const message = error instanceof Error ? error.message : String(error)
	if (SHARED_VALIDATION_MESSAGES.has(message) || options.validationMessages?.has(message) === true) return message
	if (error instanceof EndpointCheckFailure) {
		const failures = error.checks.filter(check => check.status === 'failed')
		if (failures.length !== 0) return [...new Set(failures.map(checkFailure))].join('; ')
	}
	const parsed = methodFailure(message)
	if (parsed !== undefined) return safeMethodFailure(parsed.target, parsed.method, parsed.detail) ?? options.fallback
	const mismatch = /^(https?:\/\/[^ ]+) returned chain (\d+)(?:; expected chain (\d+))?$/.exec(message)
	if (mismatch?.[1] !== undefined && mismatch[2] !== undefined) {
		const target = publicTarget(mismatch[1])
		if (target !== undefined) return mismatch[3] === undefined ? `${target} returned chain ${mismatch[2]}` : `${target} returned chain ${mismatch[2]}; expected chain ${mismatch[3]}`
	}
	return options.fallback
}
