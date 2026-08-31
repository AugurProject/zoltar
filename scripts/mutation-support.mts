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

export function classifyMutantResult(exitCode: number, junitXml: string) {
	if (exitCode === 0) return 'survived' as const
	if (!junitXml.includes('<testcase') || !junitXml.includes('<failure')) throw new Error('Mutation runner exited unsuccessfully without a recorded test assertion failure')
	return 'killed' as const
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
