import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export function countEntrypoints(signatureCounts: Map<string, number> | undefined): number {
	assert.ok(signatureCounts, 'Every contract reference must document at least one entrypoint')
	return Array.from(signatureCounts.values()).reduce((total, count) => total + count, 0)
}

// Returns the sorted `Delegate.function` pairs whose selectors a contract's fallback names.
export function getFallbackSelectorReferences(source: string, sourceLabel: string): string[] {
	const fallbackMatch = source.match(/^\s*fallback\s*\(\s*\)\s*external[^{]*\{/m)
	assert.ok(fallbackMatch?.index !== undefined, `${sourceLabel} must declare an external fallback`)
	const bodyStart = fallbackMatch.index + fallbackMatch[0].length
	let depth = 1
	let bodyEnd = bodyStart
	while (depth > 0 && bodyEnd < source.length) {
		const character = source[bodyEnd]
		if (character === '{') depth += 1
		if (character === '}') depth -= 1
		bodyEnd += 1
	}
	assert.equal(depth, 0, `${sourceLabel} fallback body must be balanced`)
	return Array.from(new Set(Array.from(source.slice(bodyStart, bodyEnd).matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\.selector\b/g), match => `${match[1]}.${match[2]}`))).sort()
}

export function getCompiledContractAbi(compiledArtifacts: unknown, sourcePath: string, contractName: string): unknown[] {
	assert.ok(isRecord(compiledArtifacts), 'solidity/artifacts/Contracts.json must contain an object')
	const contracts = compiledArtifacts['contracts']
	assert.ok(isRecord(contracts), 'solidity/artifacts/Contracts.json must contain contract outputs')
	const artifactSourcePath = sourcePath.replace(/^solidity\//, '')
	const sourceContracts = contracts[artifactSourcePath]
	assert.ok(isRecord(sourceContracts), `Compiled artifacts are missing ${artifactSourcePath}`)
	const contract = sourceContracts[contractName]
	assert.ok(isRecord(contract), `Compiled artifacts are missing ${artifactSourcePath}#${contractName}`)
	const abi = contract['abi']
	assert.ok(Array.isArray(abi), `Compiled artifact ${artifactSourcePath}#${contractName} is missing its ABI`)
	return abi
}

export function computeCompiledAbiFingerprint(abi: unknown[]): string {
	return createHash('sha256')
		.update(
			abi
				.map(entry => canonicalizeJson(entry))
				.sort()
				.join('\n'),
		)
		.digest('hex')
}

function canonicalizeJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(item => canonicalizeJson(item)).join(',')}]`
	assert.ok(isRecord(value), 'Compiled ABI contains an unsupported JSON value')
	return `{${Object.keys(value)
		.sort()
		.map(key => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
		.join(',')}}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
