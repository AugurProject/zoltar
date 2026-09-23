import { Fragment, h, render } from 'preact'
import { formatAmount } from '@zoltar/bot-shared/dashboard/amount'
import { createMetric } from '@zoltar/bot-shared/dashboard/components'
import { element } from '@zoltar/bot-shared/dashboard/dom'
import { renderOperatorHealth } from '@zoltar/bot-shared/dashboard/health-panel'
import type { Configuration, Snapshot } from './api-validation.ts'

let renderedAlertKey: string | undefined
const stateReceiptTimes = new WeakMap<Snapshot, number>()

export function renderOverviewHealth(snapshot: Snapshot, configuration: Configuration | undefined, stale = false) {
	if (!stateReceiptTimes.has(snapshot)) stateReceiptTimes.set(snapshot, Date.now())
	const limit = configuration?.strategy['maximumTotalDeployedRep']
	renderOperatorHealth(element('operator-health', HTMLDivElement), {
		mode: snapshot.execute ? 'Live armed' : 'Dry run',
		lastScanAt: snapshot.lastScanAt,
		capitalAtRisk: `${formatAmount(snapshot.metrics.deployedRep, 'REP')} / ${formatAmount(limit === undefined ? undefined : String(limit), 'REP')}`,
		recoveryItems: snapshot.pendingTransactions.length + snapshot.pendingStagedOperations.length,
		lastAction: snapshot.activities[0]?.message ?? 'No action yet',
		paused: snapshot.paused,
		stale,
		stateReceivedAt: stateReceiptTimes.get(snapshot),
	})
}

export function renderOverviewMetrics(snapshot: Snapshot, configuration: Configuration | undefined, stale = false) {
	element('metrics', HTMLDivElement).replaceChildren(
		createMetric('Pools', snapshot.metrics.poolCount.toString()),
		createMetric('Selected', snapshot.metrics.selectedPoolCount.toString()),
		createMetric('Approved universes', snapshot.metrics.approvedUniverseCount.toString()),
		createMetric('Eligible pools', snapshot.metrics.eligiblePoolCount.toString()),
		createMetric('Candidates', snapshot.metrics.candidateCount.toString()),
		createMetric('Open interest assumed', formatAmount(snapshot.metrics.assumedOpenInterestEth, 'ETH')),
	)
	element('wallet-metrics', HTMLDivElement).replaceChildren(createMetric('Wallet ETH', formatAmount(snapshot.metrics.walletEth, 'ETH')), createMetric('Wallet REP', formatAmount(snapshot.metrics.walletRep, 'REP')), createMetric('REP deployed in pools', formatAmount(snapshot.metrics.deployedRep, 'REP')))
	renderOverviewHealth(snapshot, configuration, stale)
}

export function renderOverviewAlerts(snapshot: Pick<Snapshot, 'alerts' | 'pendingTransactions'>) {
	const alertKey = `${snapshot.pendingTransactions.length.toString()}\n${snapshot.alerts.map(alert => `${alert.severity}:${alert.message}`).join('\n')}`
	if (renderedAlertKey === alertKey) return
	renderedAlertKey = alertKey
	const alerts = overviewAlertRows(snapshot)
	const target = element('operator-alerts', HTMLUListElement)
	target.classList.toggle('hidden', alerts.length === 0)
	render(
		h(Fragment, null, ...alerts.map((alert, index) => h('li', { key: index, class: `notice alert-row ${alert.severity}` }, h('span', null, alert.message), alert.actionHref === undefined || alert.actionLabel === undefined ? undefined : h('a', { class: 'alert-action', href: alert.actionHref }, alert.actionLabel)))),
		target,
	)
}

function overviewAlertRows(snapshot: Pick<Snapshot, 'alerts' | 'pendingTransactions'>) {
	const alerts: { actionHref?: string; actionLabel?: string; message: string; severity: 'error' | 'warning' }[] = snapshot.alerts.map(alert => ({ ...alert }))
	if (snapshot.pendingTransactions.length > 0) {
		const recoveryAlert = alerts.find(alert => alert.severity === 'error' && alert.message.startsWith(`${snapshot.pendingTransactions.length.toString()} transaction intent`) && alert.message.includes('recovery before execution can continue'))
		if (recoveryAlert === undefined)
			alerts.unshift({
				actionHref: '/operations#recovery',
				actionLabel: 'Review recovery',
				message: `${snapshot.pendingTransactions.length.toString()} transaction ${snapshot.pendingTransactions.length === 1 ? 'intent requires' : 'intents require'} operator recovery before execution can continue.`,
				severity: 'warning',
			})
		else {
			recoveryAlert.actionHref = '/operations#recovery'
			recoveryAlert.actionLabel = 'Review recovery'
		}
	}
	return alerts
}
