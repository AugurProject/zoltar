import { decodeEventLog, decodeFunctionData, parseTransaction, type Address, type TransactionReceipt } from '@zoltar/bot-shared/ethereum'
import { openOraclePriceCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'
import type { PendingTransactionIntent } from '#state/operator-state'

const sameAddress = (left: Address, right: Address) => left.toLowerCase() === right.toLowerCase()

type OperationIdentity = { coordinator: Address; operation: 0 | 1; operator: Address; target: Address; receiver: Address; amount: bigint }
type ReceiptOutcome = { type: 'terminal-success' } | { type: 'terminal-failure'; reason: string } | { type: 'queued'; queuedOperationId: bigint; identity: OperationIdentity }

function operationIdentity(expectation: Exclude<PendingTransactionIntent['receiptExpectation'], { type: 'transaction' }>, intent?: PendingTransactionIntent): OperationIdentity {
	if (intent === undefined) {
		if (expectation.type === 'pending-liquidation') return { ...expectation, operation: 0 }
		throw new Error('Coordinator receipt requires signed operation identity')
	}
	const transaction = parseTransaction(intent.serializedTransaction)
	if (transaction.to === undefined || !sameAddress(transaction.to, expectation.coordinator) || transaction.data === undefined) throw new Error('Signed coordinator intent does not match receipt expectation')
	const call = decodeFunctionData({ abi: openOraclePriceCoordinatorAbi, data: transaction.data })
	let identity: OperationIdentity
	if (call.functionName === 'requestPriceIfNeededAndStageLiquidation') {
		identity = { coordinator: expectation.coordinator, operation: 0, operator: intent.sender, target: call.args[0], receiver: call.args[1], amount: call.args[2] }
	} else if (call.functionName === 'requestPriceIfNeededAndStageOperation' && call.args[0] === 1n && sameAddress(call.args[1], intent.sender)) {
		identity = { coordinator: expectation.coordinator, operation: 1, operator: intent.sender, target: call.args[1], receiver: intent.sender, amount: call.args[2] }
	} else throw new Error('Unsupported signed coordinator operation')
	if (expectation.type !== 'pending-liquidation') {
		if (identity.operation !== expectation.operation) throw new Error('Signed operation type conflicts with receipt expectation')
	} else if (identity.operation !== 0 || !sameAddress(identity.operator, expectation.operator) || !sameAddress(identity.target, expectation.target) || !sameAddress(identity.receiver, expectation.receiver) || identity.amount !== expectation.amount) {
		throw new Error('Signed operation identity conflicts with receipt expectation')
	}
	return identity
}

export function validateReceiptExpectation(receipt: TransactionReceipt, expectation: PendingTransactionIntent['receiptExpectation'], intent?: PendingTransactionIntent): ReceiptOutcome {
	if (intent !== undefined && receipt.transactionHash.toLowerCase() !== intent.hash.toLowerCase()) throw new Error('Receipt transaction does not match signed intent')
	if (receipt.status === 'reverted') return { type: 'terminal-failure', reason: `Transaction ${receipt.transactionHash} reverted` }
	if (expectation.type === 'transaction') return { type: 'terminal-success' }
	const identity = operationIdentity(expectation, intent)
	const events = receipt.logs.filter(log => sameAddress(log.address, identity.coordinator)).map(log => decodeEventLog({ abi: openOraclePriceCoordinatorAbi, data: log.data, topics: log.topics }))
	const queues = events.filter(event => event.eventName === 'StagedOperationQueued')
	const routes = events.filter(event => event.eventName === 'LiquidationRouteStaged')
	const outcomes = events.filter(event => event.eventName === 'ExecutedStagedOperation')
	const queue = queues[0]?.args
	if (queues.length !== 1 || queue === undefined || queue.operation !== BigInt(identity.operation) || !sameAddress(queue.operator, identity.operator) || !sameAddress(queue.targetVault, identity.target) || queue.operationValue !== identity.amount)
		throw new Error('Coordinator receipt has missing or conflicting queue identity')
	if (identity.operation === 0) {
		const route = routes[0]?.args
		if (routes.length !== 1 || route === undefined || route.operationId !== queue.operationId || !sameAddress(route.operator, identity.operator) || !sameAddress(route.targetVault, identity.target) || !sameAddress(route.receiverVault, identity.receiver) || route.requestedDebtAttoEth !== identity.amount)
			throw new Error('Coordinator receipt has missing or conflicting liquidation route')
	} else if (routes.length !== 0) throw new Error('Self operation receipt contains a conflicting liquidation route')
	const outcome = outcomes[0]?.args
	if (outcomes.length > 1 || (outcome !== undefined && (outcome.operationId !== queue.operationId || outcome.operation !== queue.operation))) throw new Error('Coordinator receipt has conflicting operation outcomes')
	if (outcome !== undefined) {
		if (queue.isPendingSlot) throw new Error('Coordinator receipt has conflicting pending and terminal evidence')
		return outcome.success ? { type: 'terminal-success' } : { type: 'terminal-failure', reason: outcome.errorMessage }
	}
	if (!queue.isPendingSlot) throw new Error('Coordinator receipt did not confirm an outcome or pending settlement slot')
	return { type: 'queued', queuedOperationId: queue.operationId, identity }
}
