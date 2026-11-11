import { sharedPoolPriceFeedAbi } from '@zoltar/bot-shared/contracts/abi'
import { decodeEventLog, keccak256, toHex, parseTransaction, type BlockTransaction, type TransactionReceipt } from '@zoltar/bot-shared/ethereum'
import type { PendingTransactionIntent, RuntimeState } from '#state/operator-state'
import { sameSponsoredReport, type SponsoredReport } from '#state/sponsored-reports'
import { applyPortfolioFundingEffect } from '#state/portfolio-instructions'
import { reportOperationOutcomes } from './report-operation-outcomes.ts'

const assignedTopic = keccak256(toHex('ReportFundingAssigned(uint256,address,address)'))
export const terminalReportTopics = [keccak256(toHex('PriceReported(uint256,uint256,uint256)')), keccak256(toHex('PriceReportRejected(uint256,string,uint256,uint256,uint256,uint256)')), keccak256(toHex('PendingReportRecovered(uint256,uint256,uint256,uint256,uint256,uint256)'))]

export function registerSponsoredReport(state: RuntimeState, intent: PendingTransactionIntent, receipt: Pick<TransactionReceipt, 'blockNumber' | 'logs'>) {
	const sponsorship = intent.reportSponsorship
	if (sponsorship === undefined) return
	const assigned = receipt.logs.filter(log => log.address.toLowerCase() === sponsorship.feed.toLowerCase() && log.topics[0] === assignedTopic)
	if (assigned.length !== 1 || assigned[0] === undefined) throw new Error('Sponsored report receipt must identify one report')
	const event = decodeEventLog({ abi: sharedPoolPriceFeedAbi, data: assigned[0].data, topics: assigned[0].topics })
	if (event.eventName !== 'ReportFundingAssigned' || event.args.sponsor.toLowerCase() !== intent.sender.toLowerCase()) throw new Error('Sponsored report receipt has an unexpected sponsor')
	const report = { ...sponsorship, reportId: event.args.reportId, sponsor: intent.sender, createdBlock: receipt.blockNumber, nextBlock: receipt.blockNumber }
	if (!(state.sponsoredReports ?? []).some(item => sameSponsoredReport(item, report))) state.sponsoredReports = [...(state.sponsoredReports ?? []), report]
}

function isTerminalReportReceipt(report: SponsoredReport, receipt: TransactionReceipt) {
	return (
		receipt.status === 'success' &&
		receipt.logs.some(log => {
			if (log.address.toLowerCase() !== report.feed.toLowerCase() || !terminalReportTopics.some(topic => topic === log.topics[0])) return false
			const event = decodeEventLog({ abi: sharedPoolPriceFeedAbi, data: log.data, topics: log.topics })
			return (event.eventName === 'PriceReported' || event.eventName === 'PriceReportRejected' || event.eventName === 'PendingReportRecovered') && event.args.reportId === report.reportId
		})
	)
}

/** All operations in bot-created reports are takeovers. Any successful takeover
 * pledges ALL idle receiver principal; all failures leave the prefunding free. */
export function applySponsoredReportReceipt(state: RuntimeState, report: SponsoredReport, receipt: TransactionReceipt, label: string) {
	if (!isTerminalReportReceipt(report, receipt)) return undefined
	const outcome = reportOperationOutcomes({ reportOperations: { feed: report.feed, reportId: report.reportId }, sender: report.sponsor, label }, receipt)
	if (outcome !== undefined && outcome.succeeded > 0) state.portfolioFunding = applyPortfolioFundingEffect(state.portfolioFunding ?? {}, { key: report.fundingKey, operation: 'consume', amount: 0n })
	state.sponsoredReports = (state.sponsoredReports ?? []).filter(item => !sameSponsoredReport(item, report))
	return outcome
}

/** Fee replacements may change gas terms, but only an identical economic call
 * can inherit the automatic takeover-report classification. */
export function registerSponsoredReplacement(state: RuntimeState, intent: PendingTransactionIntent, receipt: Pick<TransactionReceipt, 'blockNumber' | 'logs' | 'status'>, transaction: Pick<BlockTransaction, 'to' | 'input' | 'value'>) {
	if (intent.reportSponsorship === undefined || receipt.status !== 'success') return
	const original = parseTransaction(intent.serializedTransaction)
	if (original.to?.toLowerCase() !== transaction.to?.toLowerCase() || (original.data ?? '0x').toLowerCase() !== transaction.input.toLowerCase() || (original.value ?? 0n) !== transaction.value) return
	registerSponsoredReport(state, intent, receipt)
}
