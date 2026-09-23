import { Fragment, h, render } from 'preact'
import type { PublicOperatorSnapshot, PublicTransactionActivity } from '#state/operator-state'
import { amount, exactAmount, transactionKindLabel } from './dashboard-format.ts'
import { element, setText, shorten } from './dom.ts'
import { renderOperatorHealth } from '@zoltar/bot-shared/dashboard/health-panel'

export function renderHealth(snapshot: PublicOperatorSnapshot, scanIntervalMilliseconds: number | undefined, stale: boolean) {
	renderOperatorHealth(element('operator-health'), {
		mode: snapshot.mode === 'execute' ? 'Live armed' : 'Dry run',
		lastScanAt: snapshot.lastPollAt,
		scanStaleAfterMilliseconds: scanIntervalMilliseconds === undefined ? undefined : Math.max(30_000, scanIntervalMilliseconds * 3),
		capitalAtRisk: `${exactAmount(snapshot.risk.usage.lockedWeth, 'WETH')} / ${exactAmount(snapshot.risk.limits.maxTotalLockedWeth, 'WETH')}`,
		recoveryItems: snapshot.positions.filter(position => position.status === 'recovery-required').length + snapshot.transactionActivity.filter(transaction => transaction.status === 'confirmation-unknown').length,
		lastAction: snapshot.transactionActivity[0] === undefined ? 'No action yet' : transactionKindLabel(snapshot.transactionActivity[0]),
		paused: snapshot.paused,
		stale,
	})
}

export function renderBalances(snapshot: PublicOperatorSnapshot) {
	setText('wallet-address', snapshot.wallet === undefined ? 'No execution wallet' : snapshot.wallet)
	const list = element('balance-list')
	if (snapshot.balances === undefined) {
		render(h('p', { class: 'balance-empty' }, 'Set a local signer to load its ETH, WETH, REP, and executable portfolio balances.'), list)
		return
	}
	const values: [string, string][] = [
		['ETH', amount(snapshot.balances.availableEth, 'ETH')],
		['WETH', amount(snapshot.balances.availableWeth, 'WETH')],
		['REP', amount(snapshot.balances.availableRep, 'REP')],
		['REP executable value', amount(snapshot.balances.repValueWeth, 'WETH')],
		['Executable portfolio', amount(snapshot.balances.totalValueWeth, 'WETH')],
	]
	render(h(Fragment, null, ...values.map(([label, value]) => h('div', { class: 'balance-row', key: label }, h('span', null, label), h('strong', null, value)))), list)
}

const transactionLabels = ['Updated', 'Report', 'Transaction', 'Kind', 'Delivery', 'Status', 'Target results', 'Estimated net', 'Tracked net', 'Actual gas']

export function renderTransactions(transactions: readonly PublicTransactionActivity[], explorerUrl = 'https://etherscan.io') {
	const filter = element('transaction-filter', HTMLSelectElement).value
	const visible = filter === 'all' ? transactions : transactions.filter(transaction => transaction.status === filter)
	const rows = visible.map(transaction => {
		const accepted = transaction.acceptedTargets.map(target => `accepted: ${target}`)
		const failed = transaction.failedTargets.map(target => `failed: ${target.target}${target.error === undefined ? '' : ` (${target.error})`}`)
		const targets = [...accepted, ...failed].join(', ') || '—'
		const link = h('a', { href: `${explorerUrl}/tx/${transaction.hash}`, 'data-focus-key': `transaction:${transaction.reportId ?? 'wallet'}:${transaction.hash}`, target: '_blank', rel: 'noreferrer', title: transaction.hash }, shorten(transaction.hash))
		const cells = [
			new Date(transaction.updatedAt).toLocaleString(),
			transaction.reportId ?? '—',
			link,
			transactionKindLabel(transaction),
			transaction.mode,
			transaction.status.replaceAll('-', ' '),
			targets,
			exactAmount(transaction.estimatedNetProfitEth, 'ETH'),
			exactAmount(transaction.trackedNetProfitEth, 'ETH'),
			exactAmount(transaction.actualGasCostEth, 'ETH'),
		]
		return h('tr', { key: transaction.hash }, ...cells.map((value, index) => h('td', { 'data-label': transactionLabels[index] }, value)))
	})
	render(h(Fragment, null, ...rows), element('transactions-body', HTMLTableSectionElement))
	element('transactions-empty').hidden = visible.length !== 0
	setText('transaction-count', `${visible.length.toString()} shown · ${transactions.length.toString()} tracked`)
}
