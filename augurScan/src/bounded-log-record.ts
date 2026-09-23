// Bound traversal and strings before JSON.stringify, including keys and headers.
// No toJSON hooks are invoked. The final check includes JSON escaping and newline.
const TRUNCATED_LINE = '{"truncated":true}\n'
export const MINIMUM_LOG_RECORD_BYTES = Buffer.byteLength(TRUNCATED_LINE)

export const boundedLogLine = (record: unknown, maximumBytes: number): string => {
	let remaining = Math.min(maximumBytes, 16 * 1024)
	let nodes = 256
	let truncated = false
	const seen = new WeakSet<object>()
	const text = (value: string): string => {
		const limit = Math.min(remaining, 4096)
		let end = Math.min(value.length, limit)
		// Do not cut a surrogate pair; JSON.stringify escapes lone surrogates.
		if (end > 0 && end < value.length && /[\uD800-\uDBFF]/u.test(value[end - 1] ?? '')) end--
		remaining -= end
		if (end < value.length) truncated = true
		return value.slice(0, end)
	}
	const preview = (value: unknown, depth: number): unknown => {
		if (--nodes < 0 || remaining <= 0 || depth > 8) {
			truncated = true
			return undefined
		}
		if (typeof value === 'string') {
			const prefix = text(value)
			return prefix.length === value.length ? prefix : { preview: prefix, originalUtf16CodeUnits: value.length, truncated: true }
		}
		if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
		if (value === undefined) return undefined
		if (typeof value !== 'object' || seen.has(value)) {
			truncated = true
			return undefined
		}
		seen.add(value)
		if (Array.isArray(value)) {
			const result: unknown[] = []
			for (let index = 0; index < value.length; index++) {
				if (nodes <= 0 || remaining <= 0) {
					truncated = true
					break
				}
				result.push(preview(value[index], depth + 1))
			}
			return result
		}
		const result: Record<string, unknown> = Object.create(null)
		const entries = value instanceof Headers ? value.entries() : undefined
		if (entries !== undefined) {
			for (const [key, item] of entries) {
				if (nodes <= 0 || remaining <= 0) {
					truncated = true
					break
				}
				result[text(key)] = preview(item, depth + 1)
			}
		} else {
			for (const key in value) {
				if (--nodes < 0 || remaining <= 0) {
					truncated = true
					break
				}
				if (!Object.hasOwn(value, key)) continue
				const descriptor = Object.getOwnPropertyDescriptor(value, key)
				if (descriptor === undefined || !('value' in descriptor)) {
					truncated = true
					continue
				}
				result[text(key)] = preview(descriptor.value, depth + 1)
			}
		}
		return result
	}
	const bounded = preview(record, 0)
	const line = `${JSON.stringify(truncated ? { truncated: true, record: bounded } : bounded) ?? 'null'}\n`
	return Buffer.byteLength(line) <= maximumBytes ? line : TRUNCATED_LINE
}
