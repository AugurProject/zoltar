import { expect, test } from 'bun:test'
import { recordDryRun } from '../../src/runtime/scheduled-operation.ts'
import type { OperationPlan } from '../../src/operations/types.ts'
import type { RuntimeState } from '../../src/state/operator-state.ts'
import { publicChaosState } from '../../src/dashboard/dashboard-server.ts'

const plan: OperationPlan = {
	classification: 'selectable',
	createdAtBlock: '4210',
	definitionId: 'zoltar.question.create-categorical',
	ecosystem: 'zoltar',
	id: 'plan-1',
	label: 'Create categorical question',
	metadata: {},
	obligation: false,
	operationInputs: { outcomeCount: '4' },
	planningSeed: 7,
	deadlineTimestamp: '1789000000',
	postconditions: ['A categorical question exists in the genesis universe'],
	priority: 'random',
	risk: 'low',
	steps: [
		{
			data: '0x095ea7b3000000000000000000000000',
			evidence: [],
			gasLimit: '120000',
			id: 'approve',
			label: 'Approve REP spending',
			preflightCalls: [],
			to: '0x1111111111111111111111111111111111111111',
			value: '0',
			walletAssetDebits: [],
		},
		{
			data: '0xabcdef01000000000000000000000000',
			evidence: [],
			gasLimit: '450000',
			id: 'create',
			label: 'Create the question',
			preflightCalls: [],
			to: '0x2222222222222222222222222222222222222222',
			value: '1500',
			walletAssetDebits: [],
		},
	],
}

test('a dry-run activity records the exact planned work and publishes it to the dashboard', () => {
	const state: Pick<RuntimeState, 'activities'> = { activities: [] }
	recordDryRun(state, plan)
	const [activity] = state.activities
	expect(activity?.message).toBe('Dry-run selection: Create categorical question')
	expect(activity?.summary).toBe('2 steps across 2 contracts; low risk; random priority; no transaction signed')
	const details = activity?.details ?? ''
	expect(details.startsWith('Operation zoltar.question.create-categorical')).toBe(true)
	expect(details).toContain('Operation zoltar.question.create-categorical in zoltar; selectable; random priority; low risk; planned at block 4210.')
	expect(details).toContain('Inputs: outcomeCount → 4.')
	expect(details).toContain('1. Approve REP spending (to 0x111111…1111, selector 0x095ea7b3, gas 120000)')
	expect(details).toContain('2. Create the question (to 0x222222…2222, selector 0xabcdef01, gas 450000, value 1500 attoETH)')
	expect(details).toContain('Expected outcome: A categorical question exists in the genesis universe.')
	expect(details).toContain('Deadline: 2026-09-10T00:26:40.000Z.')
	const published = publicChaosState({ activities: state.activities })
	const publishedActivities = published['activities']
	expect(Array.isArray(publishedActivities) ? publishedActivities[0] : undefined).toMatchObject({ details })
})

test('a long plan truncates its published details visibly instead of being cut mid-sentence by the sanitizer', () => {
	const state: Pick<RuntimeState, 'activities'> = { activities: [] }
	const steps = Array.from({ length: 40 }, (_unused, index) => {
		const step = plan.steps[0]
		if (step === undefined) throw new Error('The fixture plan needs a step')
		return { ...step, id: `step-${index.toString()}`, label: `Approve the settlement token for leg ${index.toString()}` }
	})
	recordDryRun(state, { ...plan, steps })
	const details = state.activities[0]?.details ?? ''
	expect(details.length).toBe(1_000)
	expect(details.endsWith('… (truncated)')).toBe(true)
	const published = publicChaosState({ activities: state.activities })
	const publishedActivities = published['activities']
	expect(Array.isArray(publishedActivities) ? publishedActivities[0] : undefined).toMatchObject({ details })
})

test('an unsafe plan input is withheld without suppressing the rest of the published details', () => {
	const state: Pick<RuntimeState, 'activities'> = { activities: [] }
	recordDryRun(state, { ...plan, operationInputs: { description: 'Will https://example.com publish before the deadline?' } })
	const details = state.activities[0]?.details ?? ''
	expect(details).not.toContain('https://example.com')
	expect(details).toContain('Some planned detail was withheld by the log sanitizer.')
	expect(details).toContain('1. Approve REP spending')
	expect(details).toContain('Expected outcome: A categorical question exists in the genesis universe.')
	const published = publicChaosState({ activities: state.activities })
	const publishedActivities = published['activities']
	expect(Array.isArray(publishedActivities) ? publishedActivities[0] : undefined).toMatchObject({ details })
})
