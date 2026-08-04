const MEBIBYTE = 1024 * 1024

export const DEFAULT_RPC_RESPONSE_BYTES = 4 * MEBIBYTE
export const LOG_RPC_RESPONSE_BYTES = 32 * MEBIBYTE
export const RELAY_RESPONSE_BYTES = 16 * MEBIBYTE

function byteLimitDescription(maximumBytes: number) {
	return maximumBytes % MEBIBYTE === 0 ? `${(maximumBytes / MEBIBYTE).toString()} MiB` : `${maximumBytes.toString()} bytes`
}

function declaredResponseLength(response: Response) {
	const value = response.headers.get('content-length')
	if (value === null) return undefined
	if (!/^\d+$/.test(value)) throw new Error('Remote response has an invalid Content-Length header')
	const length = Number(value)
	if (!Number.isSafeInteger(length)) throw new Error('Remote response Content-Length is outside the supported range')
	return length
}

export async function boundedJsonResponse(response: Response, maximumBytes: number, label: string): Promise<unknown> {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error('JSON response byte limit must be a positive safe integer')
	const maximumDescription = byteLimitDescription(maximumBytes)
	if ((declaredResponseLength(response) ?? 0) > maximumBytes) throw new Error(`${label} response exceeds ${maximumDescription}`)
	if (response.body === null) throw new SyntaxError(`${label} returned an empty response body`)

	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let length = 0
	try {
		for (;;) {
			const chunk = await reader.read()
			if (chunk.done) break
			length += chunk.value.byteLength
			if (length > maximumBytes) {
				await reader.cancel().catch(() => undefined)
				throw new Error(`${label} response exceeds ${maximumDescription}`)
			}
			chunks.push(chunk.value)
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined)
		throw error
	}

	const body = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		body.set(chunk, offset)
		offset += chunk.byteLength
	}
	return JSON.parse(new TextDecoder().decode(body)) as unknown
}
