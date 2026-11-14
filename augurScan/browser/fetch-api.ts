import './browser-types.ts'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'

export const fetchApi = async (path: string, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<unknown> => {
	const timeout = AbortSignal.timeout(15_000)
	const response = await fetch(path, { signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]) })
	const payload: unknown = await response.json().catch(() => ({}))
	if (!response.ok) {
		const message = isPlainRecord(payload) && typeof payload['error'] === 'string' ? payload['error'] : `Request failed (${response.status})`
		const error = new Error(message)
		error.status = response.status
		throw error
	}
	return payload
}
