import { applySecurityPoolFundingEffect } from '#state/security-pool-instructions'
import { decodeEventLog, decodeFunctionData, keccak256, parseTransaction, toHex, type TransactionReceipt } from '@zoltar/bot-shared/ethereum'
import { securityPoolCapitalLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { sameAddress } from '@zoltar/core-shared/evm/address'
import { recordActivity, resolveRecoveredIntentJournal, saveDurableState, type PendingTransactionIntent, type RuntimeState } from '#state/operator-state'
import { reportOperationOutcomes } from './report-operation-outcomes.ts'
import { validateReceiptExpectation } from '#execution/receipt-validation'
import { FinalizedTakeoverExpired } from '#execution/execution-safety'

const TAKEOVER_REVERT_BUDGET_BLOCKS = 300n
const takenOverTopic = keccak256(toHex('CommitmentTakenOver(uint96,uint96,uint256,uint256)'))
type ReceiptLogs = { logs: readonly Pick<TransactionReceipt['logs'][number], 'address' | 'data' | 'topics'>[] }

/**
 * The in-call cure can heal a target and return successfully without a takeover. Only a
 * `CommitmentTakenOver` log from the called ledger for the signed source proves the position moved.
 */
function takeoverAcquiredTarget(intent: PendingTransactionIntent, receipt: ReceiptLogs) {
	const transaction = parseTransaction(intent.serializedTransaction)
	const ledger = transaction.to
	if (ledger === undefined || ledger === null || transaction.data === undefined) return false
	const call = decodeFunctionData({ abi: securityPoolCapitalLedgerAbi, data: transaction.data })
	if (call.functionName !== 'takeOverWithBounds' && call.functionName !== 'takeOverAuctionBid') return false
	const sourceId = call.functionName === 'takeOverWithBounds' ? call.args[0] : undefined
	return receipt.logs.some(log => {
		if (!sameAddress(log.address, ledger) || log.topics[0] !== takenOverTopic) return false
		const event = decodeEventLog({ abi: securityPoolCapitalLedgerAbi, data: log.data, topics: log.topics })
		return event.eventName === 'CommitmentTakenOver' && (sourceId === undefined || event.args.sourceId === sourceId)
	})
}

export function applySuccessfulSecurityPoolFunding(state: RuntimeState, intent: PendingTransactionIntent, receipt: ReceiptLogs) {
	const funding = intent.securityPoolFunding
	if (funding === undefined) return false
	if (funding.operation === 'consume' && !takeoverAcquiredTarget(intent, receipt)) return true
	state.securityPoolFunding = applySecurityPoolFundingEffect(state.securityPoolFunding ?? {}, funding)
	return false
}

export function completeSecurityPoolInstruction(state: RuntimeState, intent: PendingTransactionIntent) {
	const instruction = intent.securityPoolInstruction
	if (instruction !== undefined) state.completedSecurityPoolInstructions = { ...state.completedSecurityPoolInstructions, [instruction.id]: instruction.fingerprint }
}

// Persist removal and activity together before publishing the in-memory transition.
// A failed disk write leaves the original intent retryable.
export async function resolveFinalizedReceipt(path: string, state: RuntimeState, intent: PendingTransactionIntent, receipt: TransactionReceipt, explainTakeoverExpiry?: () => Promise<string | undefined>) {
	if (!state.pendingTransactions.some(pending => pending.hash.toLowerCase() === intent.hash.toLowerCase())) return
	const outcome = validateReceiptExpectation(receipt, intent.receiptExpectation, intent)
	const mayRescreen = state.lastExpiredTakeoverBlock === undefined || receipt.blockNumber >= state.lastExpiredTakeoverBlock + TAKEOVER_REVERT_BUDGET_BLOCKS
	const expiredReason = mayRescreen && outcome.type === 'terminal-failure' && intent.kind === 'liquidation' && intent.securityPoolInstruction === undefined && intent.reportOperations === undefined ? await explainTakeoverExpiry?.().catch(() => undefined) : undefined
	const next = { ...state, activities: [...state.activities], pendingTransactions: [...state.pendingTransactions] }
	if (expiredReason !== undefined) next.lastExpiredTakeoverBlock = receipt.blockNumber
	resolveRecoveredIntentJournal(next, intent.hash, receipt.status)
	// Funding deposited for a takeover stays journaled, and so returnable, until a takeover actually acquires the target.
	const curedWithoutTakeover = outcome.type === 'terminal-success' && applySuccessfulSecurityPoolFunding(next, intent, receipt)
	// Consume reverted instructions too: retrying a deliberate financial action requires a new operator instruction.
	completeSecurityPoolInstruction(next, intent)
	const operations = outcome.type === 'terminal-success' ? reportOperationOutcomes(intent, receipt) : undefined
	let result: { message: string; status: 'confirmed' | 'failed' | 'info' } = operations ?? { message: `${intent.label}: completed`, status: 'confirmed' }
	if (outcome.type === 'terminal-failure') result = { message: `${intent.label} failed: ${outcome.reason}`, status: 'failed' }
	else if (curedWithoutTakeover) result = { message: `${intent.label}: takeover cured target; no position acquired`, status: 'info' }
	recordActivity(next, {
		hash: intent.hash,
		details: expiredReason === undefined || receipt.effectiveGasPrice === undefined ? expiredReason : `${expiredReason}. Gas cost ${receipt.gasUsed * receipt.effectiveGasPrice} attoETH.`,
		kind: intent.kind,
		...result,
	})
	await saveDurableState(path, next)
	state.securityPoolFunding = next.securityPoolFunding
	state.completedSecurityPoolInstructions = next.completedSecurityPoolInstructions
	state.lastExpiredTakeoverBlock = next.lastExpiredTakeoverBlock
	state.activities = next.activities
	state.pendingTransactions = next.pendingTransactions
	if (expiredReason !== undefined) throw new FinalizedTakeoverExpired(expiredReason)
	if (outcome.type === 'terminal-failure') throw new Error(`${intent.label} failed: ${outcome.reason}`)
}
