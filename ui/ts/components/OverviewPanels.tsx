import { LoadableValue } from './LoadableValue.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import type { OverviewPanelsProps } from '../types/components.js'

export function OverviewPanels({ accountState, universeLabel, isRefreshing, onConnect, onRefresh }: OverviewPanelsProps) {
	return (
		<section className="overview-shell">
			<article className="panel overview-panel overview-wallet-panel">
				<div className="panel-header overview-wallet-header">
					<div className="overview-wallet-summary">
						<div className="overview-brand-lockup">
							<h1 className="overview-app-title">Augur PLACEHOLDER</h1>
						</div>
						<div className="overview-inline-metrics">
							<div className="overview-address-metric">
								<span className="metric-label">Address</span>
								<strong>{accountState.address ?? 'Not connected'}</strong>
							</div>
							<div>
								<span className="metric-label">ETH</span>
								<strong>
									<LoadableValue loading={isRefreshing && accountState.ethBalance === undefined} placeholder="Loading...">
										{formatCurrencyBalance(accountState.ethBalance)} ETH
									</LoadableValue>
								</strong>
							</div>
							<div>
								<span className="metric-label">REP</span>
								<strong>
									<LoadableValue loading={isRefreshing && accountState.repBalance === undefined} placeholder="Loading...">
										{formatCurrencyBalance(accountState.repBalance)} REP
									</LoadableValue>
								</strong>
							</div>
							<div>
								<span className="metric-label">Universe</span>
								<strong>{universeLabel}</strong>
							</div>
						</div>
					</div>
					<div className="actions overview-actions">
						<button className="secondary" onClick={onRefresh} disabled={isRefreshing}>
							{isRefreshing ? 'Refreshing...' : 'Refresh'}
						</button>
						{accountState.address === undefined ? <button onClick={onConnect}>Connect Wallet</button> : undefined}
					</div>
				</div>
			</article>
		</section>
	)
}
