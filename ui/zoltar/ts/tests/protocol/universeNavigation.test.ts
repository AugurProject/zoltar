import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createMulticallStub, createReadContractStub, getContractFunctionName } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { getScalarOutcomeIndex } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import { loadUniverseOutcomePage, loadScalarUniverseOutcome } from '@zoltar/ui-zoltar-shared/protocol/universeNavigation.js'

const address = getAddress('0x00000000000000000000000000000000000000f1')
const scalar = { numTicks: 10n ** 25n, displayValueMin: 0n, displayValueMax: 10n ** 43n, answerUnit: 'units' }

function fixture({ labelCount = 2n, scalarQuestion = false, forked = true, binaryPrefix = false } = {}) {
	const batches: string[][] = []
	const outcomeIndexes: bigint[] = []
	const labelReads: (readonly unknown[])[] = []
	const labelProbeCounts: bigint[] = []
	const labels = (start: bigint, count: bigint) => {
		const result: string[] = []
		for (let index = start; index < labelCount && index < start + count; index++) {
			const binaryLabel = index === 0n ? 'Yes' : 'No'
			result.push(labelCount === 2n || (binaryPrefix && index < 2n) ? binaryLabel : `Outcome ${index + 1n}`)
		}
		return result
	}
	const client = {
		multicall: createMulticallStub(async request => {
			batches.push(request.contracts.map(getContractFunctionName))
			return request.contracts.map(contract => {
				const name = getContractFunctionName(contract)
				switch (name) {
					case 'universes':
						return [forked ? 1n : 0n, 42n, 0n, address, 0n]
					case 'zoltarQuestionData':
						return address
					case 'questions':
						return ['Fork question', 'Resolve using the published measurement.', 120n, 240n, scalarQuestion ? scalar.numTicks : 0n, scalar.displayValueMin, scalar.displayValueMax, scalar.answerUnit]
					case 'questionCreatedTimestamp':
						return 90n
					case 'getOutcomeLabels': {
						if (!('args' in contract) || !Array.isArray(contract.args) || typeof contract.args[2] !== 'bigint') throw new Error('Missing label probe count')
						labelProbeCounts.push(contract.args[2])
						return scalarQuestion ? [] : labels(0n, contract.args[2])
					}
					case 'getChildUniverseId': {
						if (!('args' in contract) || !Array.isArray(contract.args) || typeof contract.args[1] !== 'bigint') throw new Error('Missing outcome index')
						outcomeIndexes.push(contract.args[1])
						return contract.args[1] + 100n
					}
					case 'getRepToken':
						return 'args' in contract && Array.isArray(contract.args) && contract.args[0] === 100n ? zeroAddress : address
					default:
						throw new Error(`Unexpected registry read: ${name}`)
				}
			})
		}),
		readContract: createReadContractStub(async request => {
			if (request.functionName !== 'getOutcomeLabels') throw new Error('Unexpected direct read')
			const [, start, count] = request.args ?? []
			if (typeof start !== 'bigint' || typeof count !== 'bigint') throw new Error('Missing label range')
			labelReads.push([start, count])
			return labels(start, count)
		}),
	}
	return { batches, client, labelProbeCounts, labelReads, outcomeIndexes }
}

describe('bounded child universe navigation', () => {
	test('preserves complete fork question metadata alongside bounded outcome choices', async () => {
		const f = fixture()
		const page = await loadUniverseOutcomePage(f.client, address, 0n, 0n)
		expect(page).toMatchObject({
			question: {
				title: 'Fork question',
				description: 'Resolve using the published measurement.',
				questionId: '0x2a',
				createdAt: 90n,
				startTime: 120n,
				endTime: 240n,
				marketType: 'binary',
				outcomeLabels: ['Invalid', 'Yes', 'No'],
				outcomesComplete: true,
			},
		})
	})

	test('binary outcomes include Invalid, Yes and No with their deployment status', async () => {
		const f = fixture()
		const page = await loadUniverseOutcomePage(f.client, address, 0n, 0n)
		expect(page.choices.map(choice => [choice.label, choice.exists])).toEqual([
			['Invalid', false],
			['Yes', true],
			['No', true],
		])
		expect(page.hasNextPage).toBe(false)
		expect(f.outcomeIndexes).toEqual([0n, 1n, 2n])
	})

	test('a third outcome prevents a Yes and No prefix from being classified as binary', async () => {
		const f = fixture({ labelCount: 3n, binaryPrefix: true })
		const page = await loadUniverseOutcomePage(f.client, address, 0n, 0n)
		expect(page.question?.marketType).toBe('categorical')
		expect(page.question?.outcomeLabels).toEqual(['Invalid', 'Yes', 'No', 'Outcome 3'])
		expect(page.question?.outcomesComplete).toBe(true)
		expect(f.labelProbeCounts).toEqual([3n])
	})

	test.each([100n, 10n ** 25n])('categorical page reads remain bounded with %s outcomes', async labelCount => {
		const f = fixture({ labelCount })
		const first = await loadUniverseOutcomePage(f.client, address, 0n, 0n)
		expect(first.choices).toHaveLength(10)
		expect(first.choices[0]?.label).toBe('Invalid')
		expect(first.choices[9]?.label).toBe('Outcome 9')
		expect(first.hasNextPage).toBe(true)
		expect(first.question?.marketType).toBe('categorical')
		expect(first.question?.outcomesComplete).toBe(false)
		expect(first.question?.outcomeLabels).toEqual(first.choices.map(choice => choice.label))
		expect(f.batches.map(batch => batch.length)).toEqual([2, 3, 10, 10])
		expect(f.labelProbeCounts).toEqual([3n])
		expect(f.labelReads).toEqual([[0n, 11n]])
		const next = await loadUniverseOutcomePage(f.client, address, 0n, 10n)
		expect(next.choices[0]?.label).toBe('Outcome 10')
		expect(next.choices[9]?.label).toBe('Outcome 19')
		expect(next.question?.outcomeLabels).toEqual(next.choices.map(choice => choice.label))
		expect(next.question?.outcomesComplete).toBe(false)
		expect(next.question?.description).toBe(first.question?.description)
		expect(f.labelReads[1]).toEqual([9n, 11n])
	})

	test('categorical final and empty pages never reinterpret a question as scalar', async () => {
		const f = fixture({ labelCount: 12n })
		const last = await loadUniverseOutcomePage(f.client, address, 0n, 10n)
		expect(last.choices.map(choice => choice.label)).toEqual(['Outcome 10', 'Outcome 11', 'Outcome 12'])
		expect(last.hasNextPage).toBe(false)
		expect(last.question?.marketType).toBe('categorical')
		expect(last.question?.outcomesComplete).toBe(false)
		const empty = await loadUniverseOutcomePage(f.client, address, 0n, 20n)
		expect(empty.choices).toEqual([])
		expect(empty.question?.marketType).toBe('categorical')
		expect(empty.question?.outcomeLabels).toEqual([])
		expect(empty.question?.outcomesComplete).toBe(false)
	})

	test('scalar forks retain question metadata without enumerating or checking child outcomes', async () => {
		const f = fixture({ scalarQuestion: true })
		const page = await loadUniverseOutcomePage(f.client, address, 0n, 0n)
		expect(page.choices).toEqual([])
		expect(page.question).toMatchObject({ ...scalar, marketType: 'scalar', description: 'Resolve using the published measurement.', startTime: 120n, endTime: 240n, createdAt: 90n, outcomeLabels: [], outcomesComplete: true })
		expect(page.hasNextPage).toBe(false)
		expect(f.outcomeIndexes).toEqual([])
		expect(f.batches.map(batch => batch.length)).toEqual([2, 3])
		expect(f.labelProbeCounts).toEqual([3n])
		expect(f.labelReads).toEqual([])
	})

	test('resolves only the selected scalar child, including Invalid and both endpoints', async () => {
		const f = fixture({ scalarQuestion: true })
		for (const index of [0n, getScalarOutcomeIndex(scalar, 0n), getScalarOutcomeIndex(scalar, scalar.numTicks)]) {
			const child = await loadScalarUniverseOutcome(f.client, address, 0n, index)
			expect(child).toEqual({ universeId: index + 100n, exists: index !== 0n })
		}
		expect(f.outcomeIndexes).toEqual([0n, getScalarOutcomeIndex(scalar, 0n), getScalarOutcomeIndex(scalar, scalar.numTicks)])
		expect(f.batches.map(batch => batch.length)).toEqual([1, 1, 1, 1, 1, 1])
		expect(f.labelReads).toEqual([])
	})

	test('unforked universes and invalid page offsets perform no outcome or registry scans', async () => {
		const f = fixture({ forked: false })
		expect(await loadUniverseOutcomePage(f.client, address, 0n, 0n)).toEqual({ choices: [], hasNextPage: false, question: undefined })
		expect(f.batches).toHaveLength(1)
		await expect(loadUniverseOutcomePage(f.client, address, 0n, -1n)).rejects.toThrow('non-negative')
		expect(f.batches).toHaveLength(1)
	})
})
