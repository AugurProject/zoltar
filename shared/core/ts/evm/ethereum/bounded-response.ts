const MEBIBYTE = 1024 * 1024

// Read the original stream, never a tee: an unread clone can buffer without limit.
export async function boundedResponseText(response: Response, maximumBytes: number, label: string, signal?: AbortSignal | null): Promise<string> {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error('JSON response byte limit must be a positive safe integer')
	const description = maximumBytes % MEBIBYTE === 0 ? `${maximumBytes / MEBIBYTE} MiB` : `${maximumBytes} bytes`
	const reader = response.body?.getReader()
	let bytes = new Uint8Array(Math.min(maximumBytes, 16 * 1024))
	let length = 0
	const tooLarge = () => Object.assign(new Error(`${label} response exceeds ${description}`), { name: 'ResponseBodyTooLargeError', maximumBytes, receivedBytes: length })
	const onAbort = () => {
		void reader?.cancel().catch(() => undefined)
	}
	signal?.addEventListener('abort', onAbort, { once: true })
	try {
		signal?.throwIfAborted()
		const declared = response.headers.get('content-length')
		if (declared !== null) {
			if (!/^\d+$/.test(declared)) throw new Error('Remote response has an invalid Content-Length header')
			const size = Number(declared)
			if (!Number.isSafeInteger(size)) throw new Error('Remote response Content-Length is outside the supported range')
			if (size > maximumBytes) throw tooLarge()
		}
		if (reader === undefined) return ''
		for (;;) {
			const chunk = await reader.read()
			signal?.throwIfAborted()
			if (chunk.done) break
			length += chunk.value.byteLength
			if (length > maximumBytes) throw tooLarge()
			if (length > bytes.byteLength) {
				const grown = new Uint8Array(Math.min(maximumBytes, Math.max(length, bytes.byteLength * 2)))
				grown.set(bytes)
				bytes = grown
			}
			bytes.set(chunk.value, length - chunk.value.byteLength)
		}
		return new TextDecoder().decode(bytes.subarray(0, length))
	} catch (error) {
		// Cancellation may itself fail or never settle; neither may hide the error
		// or hold the request queue beyond its deadline.
		void reader?.cancel().catch(() => undefined)
		throw error
	} finally {
		signal?.removeEventListener('abort', onAbort)
		reader?.releaseLock()
	}
}
