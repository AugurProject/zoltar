import { createHash } from 'node:crypto'

const canonicalJson = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (typeof value === 'object' && value !== null)
		return `{${Object.entries(value)
			.toSorted(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
			.join(',')}}`
	return JSON.stringify(value) ?? String(value)
}

export const effectiveAbiSourceHash = (
	catalog: Readonly<Record<string, unknown>>,
	kindRouting: Readonly<Record<string, string>>,
	externalAbis: Readonly<Record<string, unknown>>,
): string =>
	`sha256:${createHash('sha256')
		.update(
			canonicalJson({
				version: 1,
				catalog,
				kindRouting,
				externalAbis,
			}),
		)
		.digest('hex')}`
