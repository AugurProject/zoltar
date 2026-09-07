import { getXmlAttribute, scanXmlTags, validateJunitDocument } from './test-timings.mts'

export type SourceMutation = {
	filePath: string
	from: string
	name: string
	testCommand: string[]
	to: string
}

export function applyExactMutation(source: string, mutation: Pick<SourceMutation, 'from' | 'name' | 'to'>) {
	const firstIndex = source.indexOf(mutation.from)
	if (firstIndex === -1) throw new Error(`Mutation ${mutation.name} did not match its source`)
	if (source.indexOf(mutation.from, firstIndex + mutation.from.length) !== -1) throw new Error(`Mutation ${mutation.name} matched its source more than once`)
	return `${source.slice(0, firstIndex)}${mutation.to}${source.slice(firstIndex + mutation.from.length)}`
}

export function classifyMutantResult(exitCode: number, junitXml: string, evidence?: { expectedTestNames: readonly string[]; mutatedModuleLoaded: boolean }) {
	if (exitCode === 0) return 'survived' as const
	validateJunitDocument(junitXml)
	const tags = scanXmlTags(junitXml)
	let testcaseDepth = 0
	let testcaseCount = 0
	let assertionFailure = false
	for (const tag of tags) {
		if (/^<testcase\b/.test(tag)) {
			testcaseCount += 1
			if (!tag.endsWith('/>')) testcaseDepth += 1
		} else if (/^<\/testcase\s*>$/.test(tag)) testcaseDepth -= 1
		else if (testcaseDepth > 0 && /^<failure\b/.test(tag)) assertionFailure = true
	}
	let suiteReportedErrors = false
	for (const tag of tags.filter(tag => /^<testsuites?\b/.test(tag))) {
		const errorCount = getXmlAttribute(tag, 'errors')
		if (errorCount === undefined) continue
		if (!/^[0-9]+$/.test(errorCount)) throw new Error('Mutation runner reported a malformed suite error count')
		if (BigInt(errorCount) > 0n) suiteReportedErrors = true
	}
	if (tags.some(tag => /^<error\b/.test(tag)) || suiteReportedErrors) throw new Error('Mutation runner reported an infrastructure error')
	if (testcaseCount === 0 || !assertionFailure) throw new Error('Mutation runner exited unsuccessfully without a recorded test assertion failure')
	if (evidence !== undefined) {
		if (!evidence.mutatedModuleLoaded) throw new Error('Mutation runner has no evidence that the mutated module loaded')
		const names = new Set(getMutationJunitTestNames(junitXml))
		if (!evidence.expectedTestNames.every(name => names.has(name))) throw new Error('Mutation runner did not execute the expected test identities')
	}
	return 'killed' as const
}

export function getMutationJunitTestNames(junitXml: string) {
	return scanXmlTags(junitXml)
		.filter(tag => /^<testcase\b/.test(tag))
		.map(tag => getXmlAttribute(tag, 'name'))
		.filter((name): name is string => name !== undefined)
}

export const MUTATION_SMOKE_CASES: readonly SourceMutation[] = [
	{
		name: 'bigint ascending comparator direction',
		filePath: 'shared/ts/bigInt.ts',
		from: 'if (left < right) return -1',
		to: 'if (left > right) return -1',
		testCommand: ['bun', 'test', 'shared/ts/bigInt.test.ts'],
	},
	{
		name: 'trading exact-output ceiling',
		filePath: 'shared/ts/trading/math.ts',
		from: 'return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n',
		to: 'return numerator === 0n ? 0n : numerator / denominator',
		testCommand: ['bun', 'test', 'shared/ts/trading/math.test.ts'],
	},
	{
		name: 'escalation non-decision threshold count',
		filePath: 'shared/ts/escalationMath.ts',
		from: 'return thresholdHits >= 2',
		to: 'return thresholdHits >= 3',
		testCommand: ['bun', 'test', 'shared/ts/escalationMath.test.ts'],
	},
]
