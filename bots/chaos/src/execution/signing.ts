import type { Account } from '@zoltar/bot-shared/ethereum'
import type { OperationPlan } from '../operations/types.ts'
import { persist } from './recovery-journal.ts'
import { assertExecutionActive, type ExecutionEnvironment } from './transaction-executor.ts'

export function withRetirementSweepBarrier(environment: ExecutionEnvironment, plan: Pick<OperationPlan, 'definitionId'>, signTransaction: NonNullable<Account['signTransaction']>) {
	if (!plan.definitionId.startsWith('retirement.sweep.')) return signTransaction
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

export function requiredExecutionWallet(environment: ExecutionEnvironment) {
	const wallet = environment.wallet
	if (wallet === undefined) throw new Error('Transaction execution requires the configured signer')
	if (wallet.account.address.toLowerCase() !== environment.sender.toLowerCase()) {
		throw new Error('Execution signer does not match the configured transaction sender')
	}
	return wallet
}
