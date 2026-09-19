import type { SettlementCandidateSnapshot, SettlementRecord, SettlementSnapshot } from '#state/settlement-store'
import { countLabel, exactAmount, rewardWithdrawalLabel, settlementDecisionReason, settlementQueueCountLabel } from './dashboard-format.js'
import { decisionBadge, element, row, setText } from './dom.js'

type Link = (value: string, kind: 'address' | 'tx', focusKey: string) => HTMLElement

const QUEUE_LABELS = ['Report', 'Decision', 'Reason', 'Reward', 'Projected gas', 'Projected net', 'Past deadline', 'Token', 'Coordinator']
const HISTORY_LABELS = ['Submitted', 'Kind', 'Report', 'Status', 'Reward', 'Projected gas', 'Actual gas', 'Transaction']

function queueRow(candidate: SettlementCandidateSnapshot, link: Link) {
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

function historyRow(record: SettlementRecord, link: Link) {
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

/** Settlement thresholds are edited in the complete configuration, so the panel states them beside the accrued figures. */
export function renderSettlements(settlements: SettlementSnapshot, link: Link) {
	const { settings } = settlements
	element('settlement-summary').replaceChildren(
		summaryRow('Settlement', settings.enabled ? `enabled · minimum net ${settings.minimumProfitWeth} ETH · gas cap ${settings.maxGasPriceGwei} gwei` : 'disabled in the complete configuration'),
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
