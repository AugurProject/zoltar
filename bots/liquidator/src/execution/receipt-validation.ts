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

export function requirePendingStagedOperation(receipt: TransactionReceipt, coordinator: Address, operator: Address, receiver: Address, target: Address, amount: bigint) {
	let queuedOperationId: bigint | undefined
	let routedOperationId: bigint | undefined
	for (const log of receipt.logs) {
		if (log.address.toLowerCase() !== coordinator.toLowerCase()) continue
		try {
			const decoded = decodeEventLog({ abi: coordinatorAbi, data: log.data, topics: log.topics })
			if (decoded.eventName === 'StagedOperationQueued' && decoded.args.operation === 0n && decoded.args.operator.toLowerCase() === operator.toLowerCase() && decoded.args.targetVault.toLowerCase() === target.toLowerCase() && decoded.args.operationAmountAttoRepOrAttoEth === amount && decoded.args.isPendingSlot)
				queuedOperationId = decoded.args.operationId
			if (decoded.eventName === 'LiquidationRouteStaged' && decoded.args.operator.toLowerCase() === operator.toLowerCase() && decoded.args.receiverVault.toLowerCase() === receiver.toLowerCase() && decoded.args.targetVault.toLowerCase() === target.toLowerCase() && decoded.args.requestedDebtAttoEth === amount)
				routedOperationId = decoded.args.operationId
		} catch (error) {
			void error
		}
	}
	if (queuedOperationId !== undefined && queuedOperationId === routedOperationId) return queuedOperationId
	throw new Error('Coordinator did not place the liquidation in a pending settlement slot')
}

export function validateReceiptExpectation(receipt: TransactionReceipt, expectation: PendingTransactionIntent['receiptExpectation']) {
	if (expectation.type === 'transaction') return { queuedOperationId: undefined }
	if (expectation.type === 'staged-success') {
		requireSuccessfulStagedOperation(receipt, expectation.coordinator, expectation.operation)
		return { queuedOperationId: undefined }
	}
	return { queuedOperationId: requirePendingStagedOperation(receipt, expectation.coordinator, expectation.operator, expectation.receiver, expectation.target, expectation.amount) }
}
