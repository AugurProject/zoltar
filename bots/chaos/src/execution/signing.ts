import type { Account } from '@zoltar/bot-shared/ethereum'
import type { OperationPlan } from '../operations/types.ts'
import { persist } from './recovery-journal.ts'
import { assertExecutionActive, type ExecutionEnvironment } from './execution-context.ts'

export function withRetirementSweepBarrier(environment: ExecutionEnvironment, plan: Pick<OperationPlan, 'definitionId'>, signTransaction: NonNullable<Account['signTransaction']>) {
	if (!plan.definitionId.startsWith('retirement.sweep.') && !(environment.state.retirement.status !== 'inactive' && plan.definitionId === 'open-oracle.weth.unwrap')) return signTransaction
	return async (transaction: Parameters<typeof signTransaction>[0]) => {
		assertExecutionActive(environment)
		// Persist immediately before entering the signer. A throwing signer may have
		// signed already, so this barrier must never be undone by error recovery.
		if (environment.state.retirement.finalSweepStartedAt === undefined) {
			environment.state.retirement.finalSweepStartedAt = new Date().toISOString()
			await persist(environment)
		}
		assertExecutionActive(environment)
		return await signTransaction(transaction)
	}
}
