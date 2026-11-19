import { applySponsoredReportReceipt, registerSponsoredReport } from './sponsored-report-receipt.ts'
import { applyPortfolioFundingEffect } from '#state/portfolio-instructions'
import type { TransactionReceipt } from '@zoltar/bot-shared/ethereum'
import { recordActivity, resolveRecoveredIntentJournal, saveDurableState, type PendingTransactionIntent, type RuntimeState } from '#state/operator-state'
import { reportOperationOutcomes } from './report-operation-outcomes.ts'
import { validateReceiptExpectation } from '#execution/receipt-validation'
import { FinalizedTakeoverExpired } from '#execution/execution-safety'

const TAKEOVER_REVERT_BUDGET_BLOCKS = 300n

// Persist removal and activity together before publishing the in-memory transition.
// A failed disk write leaves the original intent retryable.
export async function resolveFinalizedReceipt(path: string, state: RuntimeState, intent: PendingTransactionIntent, receipt: TransactionReceipt, explainTakeoverExpiry?: () => Promise<string | undefined>) {
	if (!state.pendingTransactions.some(pending => pending.hash.toLowerCase() === intent.hash.toLowerCase())) return
	const outcome = validateReceiptExpectation(receipt, intent.receiptExpectation, intent)
	const mayRescreen = state.lastExpiredTakeoverBlock === undefined || receipt.blockNumber >= state.lastExpiredTakeoverBlock + TAKEOVER_REVERT_BUDGET_BLOCKS
	const expiredReason = mayRescreen && outcome.type === 'terminal-failure' && intent.kind === 'liquidation' && intent.portfolioInstruction === undefined && intent.reportSponsorship === undefined && intent.reportOperations === undefined ? await explainTakeoverExpiry?.().catch(() => undefined) : undefined
	const next = { ...state, sponsoredReports: [...(state.sponsoredReports ?? [])], activities: [...state.activities], pendingTransactions: [...state.pendingTransactions] }
	if (expiredReason !== undefined) next.lastExpiredTakeoverBlock = receipt.blockNumber
	resolveRecoveredIntentJournal(next, intent.hash, receipt.status)
	if (outcome.type === 'terminal-success' && intent.portfolioFunding !== undefined) next.portfolioFunding = applyPortfolioFundingEffect(state.portfolioFunding ?? {}, intent.portfolioFunding)
	if (intent.portfolioInstruction !== undefined) {
		// Consume reverted instructions too: retrying a deliberate financial action
		// requires a new operator instruction, rather than repeatedly spending gas.
		next.completedPortfolioInstructions = { ...state.completedPortfolioInstructions, [intent.portfolioInstruction.id]: intent.portfolioInstruction.fingerprint }
	}
	let operations = outcome.type === 'terminal-success' ? reportOperationOutcomes(intent, receipt) : undefined
	if (outcome.type === 'terminal-success') {
		registerSponsoredReport(next, intent, receipt)
		const report = next.sponsoredReports.find(item => item.feed.toLowerCase() === intent.reportOperations?.feed.toLowerCase() && item.reportId === intent.reportOperations.reportId && item.sponsor.toLowerCase() === intent.sender.toLowerCase())
		if (report !== undefined) operations = applySponsoredReportReceipt(next, report, receipt, intent.label) ?? operations
	}
	recordActivity(next, {
		hash: intent.hash,
		details: expiredReason === undefined || receipt.effectiveGasPrice === undefined ? expiredReason : `${expiredReason}. Gas cost ${receipt.gasUsed * receipt.effectiveGasPrice} attoETH.`,
		kind: intent.kind,
		message: outcome.type === 'terminal-failure' ? `${intent.label} failed: ${outcome.reason}` : (operations?.message ?? `${intent.label}: completed`),
		status: outcome.type === 'terminal-failure' ? 'failed' : (operations?.status ?? 'confirmed'),
	})
	await saveDurableState(path, next)
	state.sponsoredReports = next.sponsoredReports
	state.portfolioFunding = next.portfolioFunding
	state.completedPortfolioInstructions = next.completedPortfolioInstructions
	state.lastExpiredTakeoverBlock = next.lastExpiredTakeoverBlock
	state.activities = next.activities
	state.pendingTransactions = next.pendingTransactions
	if (expiredReason !== undefined) throw new FinalizedTakeoverExpired(expiredReason)
	if (outcome.type === 'terminal-failure') throw new Error(`${intent.label} failed: ${outcome.reason}`)
}
