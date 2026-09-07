import type { Address, Hash } from '@zoltar/shared/ethereum'

type TransactionOperation = 'share-approval' | 'trade' | 'settlement-approval' | 'settlement' | 'liquidity'

export type TransactionContext = Readonly<{
	account: Address
	chainId: number
	market: Address
	requestRevision: number
}>

export type TransactionWorkflowState = (
	| Readonly<{ kind: 'idle' }>
	| Readonly<{ kind: 'simulating'; context: TransactionContext }>
	| Readonly<{ kind: 'ready-to-submit'; context: TransactionContext }>
	| Readonly<{ kind: 'preparing'; context: TransactionContext; operation: TransactionOperation }>
	| Readonly<{ kind: 'awaiting-signature'; context: TransactionContext; operation: TransactionOperation }>
	| Readonly<{ kind: 'pending'; context: TransactionContext; operation: TransactionOperation; originalHash: Hash; transactionHash: Hash; replacementHashes: readonly Hash[] }>
	| Readonly<{ kind: 'confirmed'; context: TransactionContext; operation: TransactionOperation; transactionHash: Hash }>
	| Readonly<{ kind: 'reverted'; context: TransactionContext; operation: TransactionOperation; transactionHash: Hash }>
	| Readonly<{ kind: 'uncertain'; context: TransactionContext; operation: TransactionOperation; transactionHash: Hash; reason: string }>
	| Readonly<{ kind: 'failed'; context?: TransactionContext; operation?: TransactionOperation; message: string }>
) &
	Readonly<{ notice?: string }>

export type TransactionWorkflowEvent =
	| Readonly<{ type: 'reset' }>
	| Readonly<{ type: 'inputs-invalidated'; preserveConfirmed?: boolean }>
	| Readonly<{ type: 'context-invalidated'; message: string }>
	| Readonly<{ type: 'simulation-started'; context: TransactionContext }>
	| Readonly<{ type: 'simulation-succeeded'; context: TransactionContext }>
	| Readonly<{ type: 'operation-preparing'; context: TransactionContext; operation: TransactionOperation }>
	| Readonly<{ type: 'signature-requested'; context: TransactionContext; operation: TransactionOperation }>
	| Readonly<{ type: 'broadcast'; context: TransactionContext; operation: TransactionOperation; transactionHash: Hash }>
	| Readonly<{ type: 'replaced'; context: TransactionContext; replacementHash: Hash }>
	| Readonly<{ type: 'confirmed'; context: TransactionContext }>
	| Readonly<{ type: 'reverted'; context: TransactionContext }>
	| Readonly<{ type: 'uncertain'; context: TransactionContext; reason: string }>
	| Readonly<{ type: 'failed'; context?: TransactionContext; operation?: TransactionOperation; message: string }>

export const idleTransactionWorkflow: TransactionWorkflowState = { kind: 'idle' }

function sameTransactionContext(left: TransactionContext, right: TransactionContext) {
	return left.account === right.account && left.chainId === right.chainId && left.market === right.market && left.requestRevision === right.requestRevision
}

function contextMatches(state: TransactionWorkflowState, context: TransactionContext) {
	return state.kind !== 'idle' && state.context !== undefined && sameTransactionContext(state.context, context)
}

function requireContext(state: TransactionWorkflowState, context: TransactionContext) {
	if (!contextMatches(state, context)) throw new Error('Stale transaction workflow event')
}

export function transactionWorkflowReducer(state: TransactionWorkflowState, event: TransactionWorkflowEvent): TransactionWorkflowState {
	if (event.type === 'reset') return idleTransactionWorkflow
	if (event.type === 'inputs-invalidated') {
		if (state.kind === 'preparing' || state.kind === 'awaiting-signature' || state.kind === 'pending' || state.kind === 'uncertain') throw new Error('Inputs cannot invalidate an active or uncertain transaction')
		return event.preserveConfirmed === true && state.kind === 'confirmed' ? state : idleTransactionWorkflow
	}
	if (event.type === 'context-invalidated') return state.kind === 'idle' ? { kind: 'failed', message: event.message } : { ...state, notice: event.message }
	if (event.type === 'simulation-started') {
		if (state.kind === 'preparing' || state.kind === 'awaiting-signature' || state.kind === 'pending' || state.kind === 'uncertain') throw new Error('A simulation cannot replace an active or uncertain transaction')
		return { kind: 'simulating', context: event.context }
	}
	if (event.type === 'simulation-succeeded') {
		requireContext(state, event.context)
		if (state.kind !== 'simulating') throw new Error('Simulation can only complete while simulating')
		return { kind: 'ready-to-submit', context: event.context }
	}
	if (event.type === 'operation-preparing') {
		if (state.kind === 'preparing' || state.kind === 'awaiting-signature' || state.kind === 'pending' || state.kind === 'uncertain') throw new Error('An operation cannot replace an active or uncertain transaction')
		return { kind: 'preparing', context: event.context, operation: event.operation }
	}
	if (event.type === 'signature-requested') {
		requireContext(state, event.context)
		if (state.kind !== 'preparing' || state.operation !== event.operation) throw new Error('Signature can only be requested for the preparing operation')
		return { kind: 'awaiting-signature', context: event.context, operation: event.operation }
	}
	if (event.type === 'broadcast') {
		requireContext(state, event.context)
		if (state.kind !== 'awaiting-signature' || state.operation !== event.operation) throw new Error('A broadcast must follow the matching signature request')
		return { kind: 'pending', context: event.context, operation: event.operation, originalHash: event.transactionHash, transactionHash: event.transactionHash, replacementHashes: [] }
	}
	if (event.type === 'replaced') {
		requireContext(state, event.context)
		if (state.kind !== 'pending') throw new Error('Only a pending transaction can be replaced')
		return { ...state, transactionHash: event.replacementHash, replacementHashes: [...state.replacementHashes, event.replacementHash] }
	}
	if (event.type === 'confirmed' || event.type === 'reverted') {
		requireContext(state, event.context)
		if (state.kind !== 'pending') throw new Error('Only a pending transaction can receive a receipt')
		return { kind: event.type, context: event.context, operation: state.operation, transactionHash: state.transactionHash, ...(state.notice === undefined ? {} : { notice: state.notice }) }
	}
	if (event.type === 'uncertain') {
		requireContext(state, event.context)
		if (state.kind !== 'pending') throw new Error('Only a pending broadcast can become uncertain')
		return { kind: 'uncertain', context: event.context, operation: state.operation, transactionHash: state.transactionHash, reason: event.reason }
	}
	if (event.context !== undefined && state.kind !== 'idle') requireContext(state, event.context)
	if (event.operation !== undefined && 'operation' in state && state.operation !== event.operation) throw new Error('Failure operation does not match the active operation')
	return { kind: 'failed', ...(event.context === undefined ? {} : { context: event.context }), ...(event.operation === undefined ? {} : { operation: event.operation }), message: event.message }
}

export type TransactionPhase = 'idle' | 'simulating' | 'ready' | 'preparing' | 'approval' | 'approval-pending' | 'approval-confirmed' | 'submitting' | 'pending' | 'confirmed' | 'error'

export function transactionPhase(state: TransactionWorkflowState): TransactionPhase {
	if (state.kind === 'ready-to-submit') return 'ready'
	if (state.kind === 'awaiting-signature') return transactionOperationIsApproval(state.operation) ? 'approval' : 'submitting'
	if (state.kind === 'pending') return transactionOperationIsApproval(state.operation) ? 'approval-pending' : 'pending'
	if (state.kind === 'confirmed') return transactionOperationIsApproval(state.operation) ? 'approval-confirmed' : 'confirmed'
	if (state.kind === 'simulating' || state.kind === 'preparing' || state.kind === 'idle') return state.kind
	return 'error'
}

function transactionOperationIsApproval(operation: TransactionOperation) {
	return operation === 'share-approval' || operation === 'settlement-approval'
}

export function transactionWorkflowHash(state: TransactionWorkflowState) {
	return state.kind === 'pending' || state.kind === 'confirmed' || state.kind === 'reverted' || state.kind === 'uncertain' ? state.transactionHash : undefined
}

export function transactionWorkflowError(state: TransactionWorkflowState, revertedMessage: string) {
	if (state.notice !== undefined) return state.notice
	if (state.kind === 'failed') return state.message
	if (state.kind === 'reverted') return revertedMessage
	return undefined
}

export function transactionWorkflowReceiptWarning(state: TransactionWorkflowState) {
	return state.kind === 'uncertain' ? state.reason : undefined
}
