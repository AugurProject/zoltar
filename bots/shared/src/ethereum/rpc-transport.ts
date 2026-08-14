import { custom as sharedCustom, http as sharedHttp, requestRpc, RpcError, type EIP1193Provider, type Transport } from '@zoltar/shared/ethereum'
import { boundedJsonResponse, DEFAULT_RPC_RESPONSE_BYTES, LOG_RPC_RESPONSE_BYTES } from '../infrastructure/bounded-json.ts'

export { RpcError }

type ClientRequestParameters = {
	method: string
	params?: unknown
}

export async function requestTransport<TValue>(transport: Transport, parameters: ClientRequestParameters): Promise<TValue> {
	return await requestRpc<TValue>(transport, parameters)
}

export type TransportOptions = {
	timeoutMilliseconds?: number | undefined
}

const DEFAULT_RPC_TIMEOUT_MILLISECONDS = 15_000

function transportTimeout(options: TransportOptions | undefined) {
	const timeoutMilliseconds = options?.timeoutMilliseconds ?? DEFAULT_RPC_TIMEOUT_MILLISECONDS
	if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 300_000) throw new Error('Transport timeoutMilliseconds must be an integer from 1 to 300000')
	return timeoutMilliseconds
}

export function http(url: string, options?: TransportOptions) {
	const requestTimeout = transportTimeout(options)
	return sharedHttp(url, {
		requestTimeout,
		responseParser: (response, method) => boundedJsonResponse(response, method === 'eth_getLogs' ? LOG_RPC_RESPONSE_BYTES : DEFAULT_RPC_RESPONSE_BYTES, `RPC ${method}`),
		retryCount: 0,
	})
}

export function custom(provider: EIP1193Provider, options?: TransportOptions) {
	const timeoutMilliseconds = transportTimeout(options)
	return sharedCustom(
		{
			request: async parameters => {
				let timeout: ReturnType<typeof setTimeout> | undefined
				try {
					return await Promise.race([
						provider.request(parameters),
						new Promise<never>((_resolve, reject) => {
							timeout = setTimeout(() => reject(new Error(`${parameters.method} timed out after ${timeoutMilliseconds.toString()}ms`)), timeoutMilliseconds)
						}),
					])
				} finally {
					if (timeout !== undefined) clearTimeout(timeout)
				}
			},
		},
		{ retryCount: 0 },
	)
}
