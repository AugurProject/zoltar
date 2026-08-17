import { custom } from './rpc-transport.ts'
import { http, requestTransport, RpcError } from './rpc-transport.ts'

export type RpcEndpointStatus = 'degraded' | 'healthy' | 'offline' | 'unknown'

export type RpcEndpointHealth = {
	consecutiveFailures: number
	error: string | undefined
	lastFailureAt: string | undefined
	lastSuccessAt: string | undefined
	latencyMilliseconds: number | undefined
	nextRetryAt: string | undefined
	status: RpcEndpointStatus
	target: string
}

export type RpcEndpointPoolOptions = {
	baseCooldownMilliseconds?: number | undefined
	maximumCooldownMilliseconds?: number | undefined
	now?: (() => number) | undefined
	random?: (() => number) | undefined
	timeoutMilliseconds?: number | undefined
}

type MutableEndpointHealth = RpcEndpointHealth & {
	nextRetryMilliseconds: number
	url: string
}

export class RpcEndpointPoolFailure extends Error {
	readonly failures: readonly { error: string; target: string }[]

	constructor(failures: readonly { error: string; target: string }[]) {
		super(`Every read RPC is unavailable: ${failures.map(failure => `${failure.target}: ${failure.error}`).join('; ')}`)
		this.name = 'RpcEndpointPoolFailure'
		this.failures = failures
	}
}

export function rpcFailureWithContext(error: unknown, target: string, method: string) {
	const detail = errorMessage(error)
	if (detail.includes(method) && detail.includes(target)) return error instanceof Error ? error : new Error(detail)
	const targetPrefix = `RPC ${target} `
	const normalizedDetail = detail.startsWith(targetPrefix) ? detail.slice(targetPrefix.length) : detail
	return new Error(normalizedDetail.includes(method) ? `RPC ${target} ${normalizedDetail}` : `RPC ${target} failed while calling ${method}: ${normalizedDetail}`, { cause: error })
}

function endpointTarget(url: string) {
	return new URL(url).origin
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

function safeErrorMessage(error: unknown, url: string, target: string) {
	return errorMessage(error).split(url).join(target)
}

function endpointRequestFailureDetail(error: unknown, endpoint: Pick<MutableEndpointHealth, 'target' | 'url'>, method: string) {
	const detail = safeErrorMessage(error, endpoint.url, endpoint.target)
	const targetPrefix = `RPC ${endpoint.target} `
	const normalizedDetail = detail.startsWith(targetPrefix) ? detail.slice(targetPrefix.length) : detail
	if (normalizedDetail.includes(method)) return normalizedDetail.startsWith('HTTP ') ? `returned ${normalizedDetail}` : normalizedDetail
	return normalizedDetail.startsWith('HTTP ') ? `returned ${normalizedDetail} while calling ${method}` : `failed while calling ${method}: ${normalizedDetail}`
}

function endpointRequestFailure(error: unknown, endpoint: Pick<MutableEndpointHealth, 'target' | 'url'>, method: string) {
	return new Error(`RPC ${endpoint.target} ${endpointRequestFailureDetail(error, endpoint, method)}`, { cause: error })
}

function retryableRpcFailure(error: unknown) {
	if (error instanceof RpcEndpointPoolFailure) return true
	if (error instanceof RpcError) {
		if (typeof error.code === 'number') return error.code === 408 || error.code === 425 || error.code === 429 || error.code >= 500
		if (error.code !== undefined) return false
		const message = error.message.toLowerCase()
		return message.includes('timed out') || /^http (408|425|429|5\d\d)\b/.test(message)
	}
	if (error instanceof Error) {
		const message = error.message.toLowerCase()
		return error.name === 'AbortError' || error.name === 'TimeoutError' || message.includes('fetch failed') || message.includes('unable to connect') || message.includes('connection refused') || message.includes('dns')
	}
	return false
}

function validatedInteger(value: number, label: string, minimum: number, maximum: number) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be an integer from ${minimum.toString()} to ${maximum.toString()}`)
	return value
}

export function createRpcEndpointPool(urls: readonly string[], options: RpcEndpointPoolOptions = {}) {
	const uniqueUrls = [...new Set(urls)]
	if (uniqueUrls.length === 0) throw new Error('RPC endpoint pool requires at least one URL')
	const timeoutMilliseconds = validatedInteger(options.timeoutMilliseconds ?? 15_000, 'RPC timeoutMilliseconds', 1, 300_000)
	const baseCooldownMilliseconds = validatedInteger(options.baseCooldownMilliseconds ?? 1_000, 'RPC baseCooldownMilliseconds', 1, 300_000)
	const maximumCooldownMilliseconds = validatedInteger(options.maximumCooldownMilliseconds ?? 30_000, 'RPC maximumCooldownMilliseconds', baseCooldownMilliseconds, 3_600_000)
	const now = options.now ?? Date.now
	const random = options.random ?? Math.random
	const endpoints: MutableEndpointHealth[] = uniqueUrls.map(url => ({
		consecutiveFailures: 0,
		error: undefined,
		lastFailureAt: undefined,
		lastSuccessAt: undefined,
		latencyMilliseconds: undefined,
		nextRetryAt: undefined,
		nextRetryMilliseconds: 0,
		status: 'unknown',
		target: endpointTarget(url),
		url,
	}))
	let preferredIndex = 0
	let latestRequestContext: { method: string; target: string } | undefined

	async function requestEndpoint(endpoint: MutableEndpointHealth, method: string, params: unknown) {
		const startedAt = now()
		try {
			const value = await requestTransport<unknown>(http(endpoint.url, { timeoutMilliseconds }), { method, params })
			latestRequestContext = { method, target: endpoint.target }
			const completedAt = now()
			endpoint.consecutiveFailures = 0
			endpoint.error = undefined
			endpoint.lastSuccessAt = new Date(completedAt).toISOString()
			endpoint.latencyMilliseconds = Math.max(0, completedAt - startedAt)
			endpoint.nextRetryAt = undefined
			endpoint.nextRetryMilliseconds = 0
			endpoint.status = 'healthy'
			return value
		} catch (error) {
			if (!retryableRpcFailure(error)) throw error
			const failedAt = now()
			endpoint.consecutiveFailures += 1
			endpoint.error = safeErrorMessage(error, endpoint.url, endpoint.target)
			endpoint.lastFailureAt = new Date(failedAt).toISOString()
			endpoint.latencyMilliseconds = Math.max(0, failedAt - startedAt)
			const exponent = Math.min(endpoint.consecutiveFailures - 1, 20)
			const cooldown = Math.min(maximumCooldownMilliseconds, baseCooldownMilliseconds * 2 ** exponent)
			const jitteredCooldown = Math.min(maximumCooldownMilliseconds, Math.round(cooldown * (1 + Math.max(0, Math.min(1, random())) * 0.2)))
			endpoint.nextRetryMilliseconds = failedAt + jitteredCooldown
			endpoint.nextRetryAt = new Date(endpoint.nextRetryMilliseconds).toISOString()
			endpoint.status = endpoint.consecutiveFailures === 1 ? 'degraded' : 'offline'
			throw error
		}
	}

	function orderedEndpoints(currentTime: number) {
		const rotated = [...endpoints.slice(preferredIndex), ...endpoints.slice(0, preferredIndex)]
		const eligible = rotated.filter(endpoint => endpoint.nextRetryMilliseconds <= currentTime)
		if (eligible.length === 0) return []
		const recoveryProbes = eligible.filter(endpoint => endpoint.status === 'degraded' || endpoint.status === 'offline')
		return [...recoveryProbes, ...eligible.filter(endpoint => !recoveryProbes.includes(endpoint))]
	}

	const provider = {
		request: async ({ method, params }: { method: string; params?: unknown }) => {
			const failures: { error: string; target: string }[] = []
			const candidates = orderedEndpoints(now())
			if (candidates.length === 0) {
				throw new RpcEndpointPoolFailure(endpoints.map(endpoint => ({ error: `cooling down until ${endpoint.nextRetryAt ?? 'the next retry window'} before calling ${method}`, target: endpoint.target })))
			}
			for (const endpoint of candidates) {
				try {
					const value = await requestEndpoint(endpoint, method, params)
					preferredIndex = endpoints.indexOf(endpoint)
					return value
				} catch (error) {
					if (!retryableRpcFailure(error)) throw endpointRequestFailure(error, endpoint, method)
					failures.push({ error: endpointRequestFailureDetail(error, endpoint, method), target: endpoint.target })
				}
			}
			throw new RpcEndpointPoolFailure(failures)
		},
	}
	const totalTimeoutMilliseconds = Math.min(300_000, timeoutMilliseconds * uniqueUrls.length + 1_000)
	return {
		latestRequestContext: () => latestRequestContext,
		prefer: (url: string) => {
			const index = endpoints.findIndex(endpoint => endpoint.url === url)
			if (index === -1) throw new Error('Cannot prefer an RPC URL outside the endpoint pool')
			preferredIndex = index
		},
		snapshot: (): readonly RpcEndpointHealth[] => endpoints.map(({ nextRetryMilliseconds: _nextRetryMilliseconds, url: _url, ...endpoint }) => ({ ...endpoint })),
		transport: custom(provider, { timeoutMilliseconds: totalTimeoutMilliseconds }),
		transportFor: (url: string) => {
			const endpoint = endpoints.find(candidate => candidate.url === url)
			if (endpoint === undefined) throw new Error('Cannot create an RPC transport outside the endpoint pool')
			return custom(
				{
					request: async ({ method, params }) => {
						if (endpoint.nextRetryMilliseconds > now()) throw new RpcEndpointPoolFailure([{ error: `cooling down until ${endpoint.nextRetryAt ?? 'the next retry window'} before calling ${method}`, target: endpoint.target }])
						try {
							return await requestEndpoint(endpoint, method, params)
						} catch (error) {
							if (!retryableRpcFailure(error)) throw endpointRequestFailure(error, endpoint, method)
							throw new RpcEndpointPoolFailure([{ error: endpointRequestFailureDetail(error, endpoint, method), target: endpoint.target }])
						}
					},
				},
				{ timeoutMilliseconds: timeoutMilliseconds + 1_000 },
			)
		},
	}
}
