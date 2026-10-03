import type { PublicSettlementRecord, SettlementCandidateSnapshot, SettlementSnapshot } from '#state/settlement-store'
import { countLabel, exactAmount, rewardWithdrawalLabel, settlementDecisionReason, settlementQueueCountLabel } from './dashboard-format.js'
import { decisionBadge, element, type ExplorerLink, row, setText } from './dom.js'

const QUEUE_LABELS = ['Report', 'Decision', 'Reason', 'Reward', 'Gas budget', 'Net at fee ceiling', 'Past deadline', 'Token', 'Coordinator']
const HISTORY_LABELS = ['Submitted', 'Kind', 'Report', 'Status', 'Reward', 'Projected gas', 'Actual gas', 'Transaction']

function queueRow(candidate: SettlementCandidateSnapshot, link: ExplorerLink) {
	return row(
		[
			candidate.reportId,
			decisionBadge(candidate.decision),
			settlementDecisionReason(candidate.decision),
			exactAmount(candidate.rewardEth, 'ETH'),
			exactAmount(candidate.projectedGasCostEth, 'ETH'),
			exactAmount(candidate.projectedNetEth, 'ETH'),
			`${candidate.elapsed} ${candidate.windowUnit}`,
			`WETH/${candidate.tokenSymbol}`,
			link(candidate.coordinator, 'address', `settlement:${candidate.reportId}:coordinator`),
		],
		QUEUE_LABELS,
	)
}

function historyRow(record: PublicSettlementRecord, link: ExplorerLink) {
	return row(
		[
			new Date(record.submittedAt).toLocaleString(),
			record.kind === 'settlement' ? 'settle' : 'withdraw reward',
			record.reportId ?? '—',
			decisionBadge(record.status),
			exactAmount(record.rewardEth, 'ETH'),
			exactAmount(record.projectedGasCostEth, 'ETH'),
			exactAmount(record.actualGasCostEth, 'ETH'),
			link(record.transactionHash, 'tx', `settlement:${record.reportId ?? 'reward'}:${record.transactionHash}`),
		],
		HISTORY_LABELS,
	)
}

function summaryRow(label: string, value: string) {
	const container = document.createElement('div')
	container.className = 'balance-row'
	const name = document.createElement('span')
	name.textContent = label
	const figure = document.createElement('strong')
	figure.textContent = value
	container.append(name, figure)
	return container
}

/** Settlement thresholds are edited under Settings › Settlement, so the panel states them beside the accrued figures. */
export function renderSettlements(settlements: SettlementSnapshot, link: ExplorerLink) {
	const { settings } = settlements
	element('settlement-summary').replaceChildren(
		summaryRow('Settlement', settings.enabled ? `enabled · minimum net ${settings.minimumProfitWeth} ETH · fee cap ${settings.maxGasPriceNanoEth} nanoETH` : 'disabled · enable it under Settings › Settlement'),
		summaryRow('Unclaimed reward in OpenOracle', rewardWithdrawalLabel(settlements)),
		summaryRow('Realized settlement income', exactAmount(settlements.realizedIncomeEth, 'ETH')),
	)
	const queue = element('settlement-queue-body', HTMLTableSectionElement)
	queue.replaceChildren(...settlements.queue.map(candidate => queueRow(candidate, link)))
	element('settlement-queue-empty').hidden = settlements.queue.length !== 0
	setText('settlement-count', settlementQueueCountLabel(settlements.queue))
	const history = element('settlement-history-body', HTMLTableSectionElement)
	history.replaceChildren(...settlements.history.map(record => historyRow(record, link)))
	element('settlement-history-empty').hidden = settlements.history.length !== 0
	setText('settlement-history-count', countLabel(settlements.history.length, 'transaction'))
}
