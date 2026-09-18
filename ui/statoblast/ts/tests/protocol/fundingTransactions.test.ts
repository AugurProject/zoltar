import { expect, test } from 'bun:test'
import { runFundingTransactions } from '@zoltar/ui-statoblast-shared/protocol/fundingTransactions.js'
import type { TransactionPlanStep } from '@zoltar/ui-core-shared/wallet/chainBackend.js'

test('funding choices use current requirements and can skip approvals satisfied during review', async () => {
	const required = [true, true, false]
	const sent: number[] = []
	let plan: readonly TransactionPlanStep[] = []
	const choices: number[][] = []
	await runFundingTransactions(
		{
			onTransactionPlan: steps => {
				plan = steps
			},
			runFundingTransaction: async (indices, execute) => {
				choices.push([...indices])
				if (choices.length === 1) {
					await execute(1)
					return true
				}
				if (choices.length === 2) {
					required[0] = false
					await execute(0)
					return true
				}
				return false
			},
		},
		required.map((_, index) => ({
			step: { functionName: 'approve' },
			isRequired: async () => required[index] === true,
			execute: async () => {
				sent.push(index)
				required[index] = false
			},
		})),
		{ functionName: 'report' },
	)
	expect(plan.map(step => step.functionName)).toEqual(['approve', 'approve', 'approve', 'report'])
	expect(choices).toEqual([[0, 1], [0], []])
	expect(sent).toEqual([1])
})

test('noninteractive consumers also skip requirements that are already satisfied', async () => {
	const sent: string[] = []
	await runFundingTransactions(
		{},
		[false, true].map((required, index) => ({
			step: { functionName: 'approve' },
			isRequired: async () => required,
			execute: async () => {
				sent.push(String(index))
			},
		})),
		{ functionName: 'report' },
	)
	expect(sent).toEqual(['1'])
})
