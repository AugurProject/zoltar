import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createTransactionStepController, transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { getTransactionReviewSignal, isTransactionPreparationScope } from '@zoltar/ui-core-shared/transactions/transactionReviewScope.js'

/** Component callbacks model a read-only plan followed by one explicitly selected operation. Protocol tests own funding writes. */
export function createPreparedOperationFixture<Arguments extends unknown[]>(label: string, onExecute: (...args: Arguments) => void | Promise<void>) {
	return async (...args: Arguments) => {
		const signal = getTransactionReviewSignal()
		if (!isTransactionPreparationScope(signal)) return await onExecute(...args)
		const controller = createTransactionStepController(signal)
		controller.setPlan([{ title: label, description: undefined, contractAddress: zeroAddress, contractLabel: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }])
		try {
			await controller.review(0)
			await onExecute(...args)
		} finally {
			const current = transactionSteps.peek()
			if (current?.reviewSignal === signal) current?.cancel()
		}
	}
}
