import { decodeEventLog, type Address, type TransactionReceipt } from '@zoltar/bot-shared/ethereum'
import { coordinatorAbi } from '#contracts/abi'
import type { PendingTransactionIntent } from '#state/operator-state'

export function requireSuccessfulStagedOperation(receipt: TransactionReceipt, coordinator: Address, operation: 0 | 1) {
	for (const log of receipt.logs) {
		if (log.address.toLowerCase() !== coordinator.toLowerCase()) continue
		try {
			const decoded = decodeEventLog({ abi: coordinatorAbi, data: log.data, topics: log.topics })
			if (decoded.eventName !== 'ExecutedStagedOperation' || decoded.args.operation !== BigInt(operation)) continue
			if (!decoded.args.success) throw new Error(`Staged operation failed: ${decoded.args.errorMessage}`)
			return
		} catch (error) {
			if (error instanceof Error && error.message.startsWith('Staged operation failed:')) throw error
		}
	}
	throw new Error('Coordinator receipt did not confirm the staged operation outcome')
}

export function requirePendingStagedOperation(receipt: TransactionReceipt, coordinator: Address, initiator: Address, target: Address, amount: bigint) {
	for (const log of receipt.logs) {
		if (log.address.toLowerCase() !== coordinator.toLowerCase()) continue
		try {
			const decoded = decodeEventLog({ abi: coordinatorAbi, data: log.data, topics: log.topics })
			if (decoded.eventName !== 'StagedOperationQueued') continue
			if (decoded.args.operation === 0n && decoded.args.initiatorVault.toLowerCase() === initiator.toLowerCase() && decoded.args.targetVault.toLowerCase() === target.toLowerCase() && decoded.args.amount === amount && decoded.args.isPendingSlot) return decoded.args.operationId
		} catch (error) {
			void error
		}
	}
	throw new Error('Coordinator did not place the liquidation in a pending settlement slot')
}

export function validateReceiptExpectation(receipt: TransactionReceipt, expectation: PendingTransactionIntent['receiptExpectation']) {
	if (expectation.type === 'transaction') return { queuedOperationId: undefined }
	if (expectation.type === 'staged-success') {
		requireSuccessfulStagedOperation(receipt, expectation.coordinator, expectation.operation)
		return { queuedOperationId: undefined }
	}
	return { queuedOperationId: requirePendingStagedOperation(receipt, expectation.coordinator, expectation.initiator, expectation.target, expectation.amount) }
}
