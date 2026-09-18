import type { TransactionPlanStep, WriteClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'

export type FundingTransaction = {
	step: TransactionPlanStep
	isRequired: () => Promise<boolean>
	execute: () => Promise<unknown>
}

// Funding actions are independent. The consuming transaction remains gated on all of them.
export async function runFundingTransactions(client: Pick<WriteClient, 'onTransactionPlan' | 'runFundingTransaction'>, actions: readonly FundingTransaction[], finalStep: TransactionPlanStep) {
	client.onTransactionPlan?.([...actions.map(action => action.step), finalStep])
	const completed = new Set<number>()
	while (true) {
		const required = (await Promise.all(actions.map(async (action, index) => (!completed.has(index) && (await action.isRequired()) ? index : undefined)))).filter(index => index !== undefined)
		const execute = async (selected: number) => {
			const action = actions[selected]
			if (action === undefined || !required.includes(selected)) throw new Error('Unexpected funding transaction selection.')
			if (!(await action.isRequired())) return
			await action.execute()
			completed.add(selected)
		}
		if (client.runFundingTransaction !== undefined) {
			if (!(await client.runFundingTransaction(required, execute))) return
		} else {
			const first = required[0]
			if (first === undefined) return
			await execute(first)
		}
	}
}
