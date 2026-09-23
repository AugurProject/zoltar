import { boundedResponseText } from '@zoltar/core-shared/evm/ethereum'
import type { JsonValue } from '../ethereum.ts'

const MEBIBYTE = 1024 * 1024

export const DEFAULT_RPC_RESPONSE_BYTES = 4 * MEBIBYTE
export const LOG_RPC_RESPONSE_BYTES = 32 * MEBIBYTE
export const RELAY_RESPONSE_BYTES = 16 * MEBIBYTE

export async function boundedJsonResponse(response: Response, maximumBytes: number, label: string): Promise<JsonValue> {
	const text = await boundedResponseText(response, maximumBytes, label)
	if (response.body === null) throw new SyntaxError(`${label} returned an empty response body`)
	return JSON.parse(text) as JsonValue
}
