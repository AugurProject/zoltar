import { formatAddress, formatCurrencyBalance } from '../lib/formatters.js'
import { isMainnetChain } from '../lib/network.js'
import type { OverviewPanelsProps } from '../types/components.js'

export function OverviewPanels({ accountState, universeLabel, isRefreshing, onConnect, onRefresh }: OverviewPanelsProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const connectLabel = accountState.address === undefined ? 'Connect Wallet' : 'Reconnect Wallet'
	const networkLabel = accountState.chainId === undefined ? 'Unknown' : isMainnet ? 'Ethereum Mainnet' : `${ accountState.chainId } (Wrong Network)`

	return (
		<section className="overview-shell">
			<div className="overview-row">
				<article className="panel overview-panel overview-wallet-panel">
					<div className="panel-header">
						<div className="panel-copy">
							<p className="panel-label">Wallet</p>
							<h2>{accountState.address === undefined ? 'Not Connected' : formatAddress(accountState.address)}</h2>
							<p className="detail">{accountState.address === undefined ? 'Connect a wallet to read balances and deploy contracts.' : 'This address is used for every onchain action in the app.'}</p>
						</div>
						<div className="actions overview-actions">
							<button className="secondary" onClick={onRefresh} disabled={isRefreshing}>
								{isRefreshing ? 'Refreshing...' : 'Refresh'}
							</button>
							<button onClick={onConnect}>{connectLabel}</button>
						</div>
					</div>
				</article>
				<article className="panel overview-panel overview-network-panel">
					<p className="panel-label">Network</p>
					<h2>{networkLabel}</h2>
					<p className="detail">{accountState.chainId === undefined ? 'Connect a wallet to detect the active chain.' : isMainnet ? 'Ready for deployment, market, oracle, reporting, vault, pool, and trading actions.' : 'Switch to Ethereum mainnet to unlock contract actions.'}</p>
				</article>
			</div>
			<article className="panel overview-panel overview-metrics-panel">
				<div className="metric-row">
					<div>
						<span className="metric-label">ETH</span>
						<strong>{formatCurrencyBalance(accountState.ethBalance)} ETH</strong>
					</div>
					<div>
						<span className="metric-label">REP</span>
						<strong>{formatCurrencyBalance(accountState.repBalance)} REP</strong>
					</div>
					<div>
						<span className="metric-label">Universe</span>
						<strong>{universeLabel}</strong>
					</div>
					<div>
						<span className="metric-label">Chain ID</span>
						<strong>{accountState.chainId === undefined ? 'Unknown' : accountState.chainId}</strong>
					</div>
				</div>
			</article>
		</section>
	)
}
