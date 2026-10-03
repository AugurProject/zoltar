import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createMulticallStub, createReadContractStub, getContractFunctionName } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { getScalarOutcomeIndex } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import { loadUniverseOutcomePage, loadScalarUniverseOutcome } from '@zoltar/ui-zoltar-shared/protocol/universeNavigation.js'

const address = getAddress('0x00000000000000000000000000000000000000f1')
const scalar = { numTicks: 10n ** 25n, displayValueMin: 0n, displayValueMax: 10n ** 43n, answerUnit: 'units' }

function fixture({ labelCount = 2n, scalarQuestion = false, forked = true } = {}) {
	const batches: string[][] = []
	const outcomeIndexes: bigint[] = []
	const labelReads: (readonly unknown[])[] = []
	const labels = (start: bigint, count: bigint) => {
		const result: string[] = []
		for (let index = start; index < labelCount && index < start + count; index++) {
			const binaryLabel = index === 0n ? 'Yes' : 'No'
			result.push(labelCount === 2n ? binaryLabel : `Outcome ${index + 1n}`)
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
						return ['Fork question', '', 0n, 1n, scalarQuestion ? scalar.numTicks : 0n, scalar.displayValueMin, scalar.displayValueMax, scalar.answerUnit]
					case 'getOutcomeLabels':
						return scalarQuestion ? [] : labels(0n, 1n)
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
	return { batches, client, labelReads, outcomeIndexes }
}

describe('bounded child universe navigation', () => {
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

	test.each([100n, 10n ** 25n])('categorical page reads remain bounded with %s outcomes', async labelCount => {
		const f = fixture({ labelCount })
		const first = await loadUniverseOutcomePage(f.client, address, 0n, 0n)
		expect(first.choices).toHaveLength(10)
		expect(first.choices[0]?.label).toBe('Invalid')
		expect(first.choices[9]?.label).toBe('Outcome 9')
		expect(first.hasNextPage).toBe(true)
		expect(f.batches.map(batch => batch.length)).toEqual([2, 2, 10, 10])
		expect(f.labelReads).toEqual([[0n, 11n]])
		const next = await loadUniverseOutcomePage(f.client, address, 0n, 10n)
		expect(next.choices[0]?.label).toBe('Outcome 10')
		expect(next.choices[9]?.label).toBe('Outcome 19')
		expect(f.labelReads[1]).toEqual([9n, 11n])
	})

	test('categorical final and empty pages never reinterpret a question as scalar', async () => {
		const f = fixture({ labelCount: 12n })
		const last = await loadUniverseOutcomePage(f.client, address, 0n, 10n)
		expect(last.choices.map(choice => choice.label)).toEqual(['Outcome 10', 'Outcome 11', 'Outcome 12'])
		expect(last.hasNextPage).toBe(false)
		const empty = await loadUniverseOutcomePage(f.client, address, 0n, 20n)
		expect(empty.choices).toEqual([])
		expect(empty.scalarQuestion).toBeUndefined()
	})

	test('scalar forks return only picker metadata without enumerating or checking child outcomes', async () => {
		const f = fixture({ scalarQuestion: true })
		const page = await loadUniverseOutcomePage(f.client, address, 0n, 0n)
		expect(page.choices).toEqual([])
		expect(page.scalarQuestion).toEqual(scalar)
		expect(page.hasNextPage).toBe(false)
		expect(f.outcomeIndexes).toEqual([])
		expect(f.batches.map(batch => batch.length)).toEqual([2, 2])
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
		expect((await loadUniverseOutcomePage(f.client, address, 0n, 0n)).choices).toEqual([])
		expect(f.batches).toHaveLength(1)
		await expect(loadUniverseOutcomePage(f.client, address, 0n, -1n)).rejects.toThrow('non-negative')
		expect(f.batches).toHaveLength(1)
	})
})
