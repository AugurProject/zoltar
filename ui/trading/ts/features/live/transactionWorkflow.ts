import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'

type TransactionOperation = 'trade' | 'settlement' | 'liquidity'

export type TransactionContext = Readonly<{
	account: Address
	chainId: number
	market: Address
	requestRevision: number
}>

export type TransactionWorkflowState = (
	| Readonly<{ kind: 'idle' }>
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
	| Readonly<{ type: 'operation-preparing'; context: TransactionContext; operation: TransactionOperation }>
	| Readonly<{ type: 'signature-requested'; context: TransactionContext; operation: TransactionOperation }>
	| Readonly<{ type: 'broadcast'; context: TransactionContext; operation: TransactionOperation; transactionHash: Hash }>
	| Readonly<{ type: 'replaced'; context: TransactionContext; replacementHash: Hash }>
	| Readonly<{ type: 'confirmed'; context: TransactionContext }>
	| Readonly<{ type: 'reverted'; context: TransactionContext }>
	| Readonly<{ type: 'uncertain'; context: TransactionContext; reason: string }>
	| Readonly<{ type: 'failed'; context?: TransactionContext; operation?: TransactionOperation; message: string }>

const idleTransactionWorkflow: TransactionWorkflowState = { kind: 'idle' }

function sameTransactionContext(left: TransactionContext, right: TransactionContext) {
	return left.account === right.account && left.chainId === right.chainId && left.market === right.market && left.requestRevision === right.requestRevision
}

function contextMatches(state: TransactionWorkflowState, context: TransactionContext) {
	return state.kind !== 'idle' && state.context !== undefined && sameTransactionContext(state.context, context)
}

function requireContext(state: TransactionWorkflowState, context: TransactionContext) {
	if (!contextMatches(state, context)) throw new Error('Stale transaction workflow event')
}

function transactionWorkflowReducer(state: TransactionWorkflowState, event: TransactionWorkflowEvent): TransactionWorkflowState {
	if (event.type === 'reset') return idleTransactionWorkflow
	if (event.type === 'inputs-invalidated') {
		if (state.kind === 'preparing' || state.kind === 'awaiting-signature' || state.kind === 'pending' || state.kind === 'uncertain') throw new Error('Inputs cannot invalidate an active or uncertain transaction')
		return event.preserveConfirmed === true && state.kind === 'confirmed' ? state : idleTransactionWorkflow
	}
	if (event.type === 'context-invalidated') return state.kind === 'idle' ? { kind: 'failed', message: event.message } : { ...state, notice: event.message }
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

/** One plain-language phase per state: preparing runs the authoritative simulation, submitting waits for the wallet signature. */
export type TransactionPhase = 'idle' | 'preparing' | 'submitting' | 'pending' | 'confirmed' | 'error'

export function transactionPhase(state: TransactionWorkflowState): TransactionPhase {
	if (state.kind === 'awaiting-signature') return 'submitting'
	if (state.kind === 'pending') return 'pending'
	if (state.kind === 'confirmed') return 'confirmed'
	if (state.kind === 'preparing' || state.kind === 'idle') return state.kind
	return 'error'
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

/** Workflow state per market key, so a transaction on one market never blocks or relabels another market's ticket. */
export type MarketTransactionWorkflows = Readonly<Record<string, TransactionWorkflowState>>

export type MarketTransactionWorkflowEvent =
	| Readonly<{ type: 'market'; market: string; event: TransactionWorkflowEvent }>
	/** Clears every market's finished or failed result; markets whose transaction still holds its lock keep their state. */
	| Readonly<{ type: 'reset-unlocked'; locked: readonly string[] }>
	/** The wallet changed: running transactions keep their state with a notice, and the market on screen shows the failure. */
	| Readonly<{ type: 'wallet-context-invalidated'; message: string; locked: readonly string[]; current: string }>

/** Names a market's workflow slot; without an addressed market the slot is the empty key. */
export function transactionMarketKey(market: Address | undefined) {
	return market?.toLowerCase() ?? ''
}

export function marketTransactionWorkflow(workflows: MarketTransactionWorkflows, market: string) {
	return workflows[market] ?? idleTransactionWorkflow
}

export function marketTransactionWorkflowsReducer(workflows: MarketTransactionWorkflows, event: MarketTransactionWorkflowEvent): MarketTransactionWorkflows {
	if (event.type === 'market') return { ...workflows, [event.market]: transactionWorkflowReducer(marketTransactionWorkflow(workflows, event.market), event.event) }
	if (event.type === 'reset-unlocked') return Object.fromEntries(Object.entries(workflows).filter(([market]) => event.locked.includes(market)))
	const next: Record<string, TransactionWorkflowState> = { ...workflows }
	for (const market of event.locked) next[market] = transactionWorkflowReducer(marketTransactionWorkflow(workflows, market), { type: 'context-invalidated', message: event.message })
	if (!event.locked.includes(event.current)) next[event.current] = transactionWorkflowReducer(marketTransactionWorkflow(workflows, event.current), { type: 'failed', message: event.message })
	return next
}
