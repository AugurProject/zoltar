import type { PublicExecutionRecord, PublicOperationEntry, PublicOperatorSnapshot, PublicPositionRecord } from '#state/operator-state'
import type { OpportunitySnapshot } from '#state/opportunity-snapshot'
import { venueLabel } from '#core/venue-strategy'
import { endpointHealthDetail, endpointRow } from '@zoltar/bot-shared/dashboard/components'
import { amount, countLabel, exactAmount, opportunityCountLabel, opportunityDecisionReason } from './dashboard-format.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { decisionBadge, type ExplorerLink, row, setText } from './dom.ts'
import { renderProfitChart } from './profit-chart.ts'

const OPPORTUNITY_LABELS = ['Report', 'Decision', 'Reference deviation', 'Executable REP / ETH', 'Reason', 'Direction', 'Estimated net', 'Required WETH', 'Required token', 'Window', 'Venue', 'Pool / manager']
const HISTORY_LABELS = ['Time', 'Report', 'Direction', 'Modeled net', 'Tracked net', 'Actual gas', 'Inventory used', 'Transaction']
const POSITION_LABELS = ['Opened', 'Report', 'Direction', 'Status', 'Hedged pre-gas', 'Entry gas', 'Lifecycle gas', 'Settler reward', 'Realized net', 'Withdrawn', 'Entry transaction']
const OPERATION_LABELS = ['Time', 'Level', 'Category', 'Report', 'Operation', 'Why', 'Details']
const NOT_PRICED = '—'

function opportunityRow(opportunity: OpportunitySnapshot, link: ExplorerLink) {
	// A skipped report never reached a venue quote, so quote-derived columns stay blank; the direction column names the WETH/token pair instead.
	if (opportunity.decision === 'skipped') {
		return row([opportunity.reportId, decisionBadge(opportunity.decision), NOT_PRICED, NOT_PRICED, opportunityDecisionReason(opportunity), `WETH/${opportunity.tokenSymbol}`, NOT_PRICED, NOT_PRICED, NOT_PRICED, `${opportunity.timeRemaining} ${opportunity.windowUnit}`, NOT_PRICED, NOT_PRICED], OPPORTUNITY_LABELS)
	}
	return row(
		[
			opportunity.reportId,
			decisionBadge(opportunity.decision),
			opportunity.centralizedPriceDeviationBps === undefined ? 'Unavailable' : `${opportunity.centralizedPriceDeviationBps} bps`,
			amount(opportunity.executablePriceRepPerEth, 'REP / ETH'),
			opportunityDecisionReason(opportunity),
			opportunity.direction === 'buy-rep' ? `buy ${opportunity.tokenSymbol}` : `sell ${opportunity.tokenSymbol}`,
			amount(opportunity.estimatedNetProfitEth, 'ETH'),
			amount(opportunity.requiredWeth, 'WETH'),
			amount(opportunity.requiredToken, opportunity.tokenSymbol),
			`${opportunity.timeRemaining} ${opportunity.windowUnit}`,
			venueLabel(opportunity.venue),
			link(opportunity.pool, 'address', `opportunity:${opportunity.reportId}:pool`),
		],
		OPPORTUNITY_LABELS,
	)
}

function historyRow(record: PublicExecutionRecord, link: ExplorerLink) {
	return row(
		[
			new Date(record.executedAt).toLocaleString(),
			record.reportId,
			record.direction === 'buy-rep' ? `buy ${record.tokenSymbol}` : `sell ${record.tokenSymbol}`,
			exactAmount(record.estimatedNetProfitWeth, 'ETH'),
			exactAmount(record.trackedNetProfitEth, 'ETH'),
			exactAmount(record.actualGasCostEth, 'ETH'),
			`${amount(record.requiredWeth, 'WETH')} · ${amount(record.requiredToken, record.tokenSymbol)}`,
			link(record.transactionHash, 'tx', `history:${record.reportId}:transaction`),
		],
		HISTORY_LABELS,
	)
}

function positionRow(position: PublicPositionRecord, link: ExplorerLink) {
	const manuallyReconciled = position.manuallyReconciled
	const awaitingEntryEvidence = position.actualEntryGasCostEth === '0'
	const awaitingLifecycleEvidence = position.hasLifecycleTransactions && !position.lifecycleReceiptRecovered
	const accountingPending = !manuallyReconciled && (awaitingEntryEvidence || awaitingLifecycleEvidence)
	let hedgedProfit = exactAmount(position.hedgedProfitBeforeGasEth, 'ETH')
	if (manuallyReconciled) hedgedProfit = 'Manual reconciliation recorded'
	else if (accountingPending) hedgedProfit = `Awaiting ${awaitingEntryEvidence ? 'entry' : 'lifecycle'} evidence`
	let lifecycleGas = exactAmount(position.lifecycleGasCostEth, 'ETH')
	if (manuallyReconciled && awaitingLifecycleEvidence) lifecycleGas = 'Manual evidence; RPC quorum unavailable'
	else if (awaitingLifecycleEvidence) lifecycleGas = 'Awaiting lifecycle evidence'
	const settlerRewardAttoEth = awaitingLifecycleEvidence ? 'Awaiting lifecycle evidence' : exactAmount(position.lifecycleSettlerRewardEth, 'ETH')
	return row(
		[
			new Date(position.openedAt).toLocaleString(),
			position.reportId,
			position.direction === 'buy-rep' ? `buy ${position.tokenSymbol}` : `sell ${position.tokenSymbol}`,
			manuallyReconciled ? `${position.status} · manual` : position.status,
			hedgedProfit,
			awaitingEntryEvidence ? 'Awaiting entry evidence' : exactAmount(position.actualEntryGasCostEth, 'ETH'),
			lifecycleGas,
			settlerRewardAttoEth,
			exactAmount(position.realizedNetProfitEth, 'ETH'),
			`${amount(position.withdrawnWeth, 'WETH')} · ${amount(position.withdrawnToken, position.tokenSymbol)}`,
			link(position.entryTransactionHash, 'tx', `position:${position.reportId}:transaction`),
		],
		POSITION_LABELS,
	)
}

function endpointHeading(text: string) {
	const heading = document.createElement('h3')
	heading.className = 'endpoint-check-heading'
	heading.textContent = text
	return heading
}

/** Renders the opportunity, execution-history, position, operation-log, and endpoint-check tables. */
export function createActivityPanels(elements: DashboardElements, link: ExplorerLink) {
	function renderOpportunities(opportunities: readonly OpportunitySnapshot[]) {
		elements.opportunitiesBody.replaceChildren(...opportunities.map(opportunity => opportunityRow(opportunity, link)))
		elements.opportunitiesEmpty.hidden = opportunities.length !== 0
		setText('opportunity-count', opportunityCountLabel(opportunities))
	}

	function renderHistory(history: readonly PublicExecutionRecord[], recordCount: number) {
		elements.historyBody.replaceChildren(...history.map(record => historyRow(record, link)))
		elements.historyEmpty.hidden = history.length !== 0
		renderProfitChart(elements.profitChart, history, recordCount)
	}

	function renderPositions(positions: readonly PublicPositionRecord[], recordCount: number) {
		elements.positionsBody.replaceChildren(...positions.map(position => positionRow(position, link)))
		elements.positionsEmpty.hidden = positions.length !== 0
		setText('position-count', recordCount > positions.length ? `Latest ${positions.length.toString()} of ${recordCount.toString()}` : countLabel(recordCount, 'durable position'))
	}

	function renderOperations(operations: readonly PublicOperationEntry[]) {
		const filter = elements.operationFilter.value
		const visibleOperations = operations.filter(operation => operation.category !== 'scan' && (filter === 'all' || operation.level === filter))
		elements.operationsBody.replaceChildren(
			...visibleOperations.map(operation => {
				const level = document.createElement('span')
				level.className = 'log-level'
				level.dataset['level'] = operation.level
				level.textContent = operation.level
				return row([new Date(operation.timestamp).toLocaleString(), level, operation.category, operation.reportId ?? '—', operation.message, operation.reason ?? '—', operation.details ?? '—'], OPERATION_LABELS)
			}),
		)
		elements.operationsEmpty.hidden = visibleOperations.length !== 0
		setText('operation-count', countLabel(visibleOperations.length, 'entry', 'entries'))
	}

	function renderEndpointChecks(snapshot: PublicOperatorSnapshot) {
		const container = elements.endpointChecks
		container.replaceChildren()
		const endpointChecksMatchActiveChain = snapshot.endpointChecks.every(check => check.chainId === undefined || check.chainId === snapshot.expectedChainId)
		const endpointChecks = endpointChecksMatchActiveChain ? snapshot.endpointChecks : []
		if (endpointChecks.length > 0) container.append(endpointHeading('Configuration validation'))
		for (const check of endpointChecks) {
			container.append(endpointRow('endpoint-check', check, check.error ?? `Chain ${check.chainId?.toString() ?? 'unconfirmed'} · ${check.kind}`))
		}
		const runtimeHealth = endpointChecksMatchActiveChain ? (snapshot.rpcEndpointHealth ?? []) : []
		if (runtimeHealth.length > 0) container.append(endpointHeading('Live RPC health'))
		for (const endpoint of runtimeHealth) {
			container.append(endpointRow('endpoint-check', endpoint, endpointHealthDetail(endpoint)))
		}
	}

	return { renderOpportunities, renderHistory, renderPositions, renderOperations, renderEndpointChecks }
}
