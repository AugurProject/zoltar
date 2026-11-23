export function positiveFuzzInteger(name: string, fallback: number) {
	const value = Number(process.env[name] ?? fallback)
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`)
	return value
}

export function auditFuzzSeeds(defaultSeeds: readonly number[]) {
	if (process.env['AUDIT_FUZZ_SEEDS'] === undefined && process.env['AUDIT_FUZZ_SEED_START'] === undefined) return defaultSeeds
	const count = positiveFuzzInteger('AUDIT_FUZZ_SEEDS', defaultSeeds.length)
	const first = positiveFuzzInteger('AUDIT_FUZZ_SEED_START', 1)
	if (count === 1 && process.env['AUDIT_FUZZ_SEED_START'] !== undefined) return [first]
	if (!Number.isSafeInteger(first + count - 1)) throw new Error('The fuzz seed range exceeds safe integers')
	return [...new Set([...defaultSeeds, ...Array.from({ length: count }, (_, index) => first + index)])]
}
