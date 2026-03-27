import { formatAddress, formatCurrencyBalance } from '../lib/formatters.js'
import { isMainnetChain } from '../lib/network.js'
import type { OverviewPanelsProps } from '../types/components.js'

export function OverviewPanels({ accountState, universeLabel }: OverviewPanelsProps) {
	const isMainnet = isMainnetChain(accountState.chainId)

	return (
		<section className="grid">
			<article className="panel">
				<p className="panel-label">Wallet</p>
				<h2>{accountState.address === undefined ? 'Not Connected' : formatAddress(accountState.address)}</h2>
				<p className="detail">{accountState.address ?? 'Connect a wallet to read balances and deploy contracts.'}</p>
				<div className="metric-row">
					<div>
						<span className="metric-label">Network</span>
						<strong>{accountState.chainId === undefined ? 'Unknown' : isMainnet ? 'Ethereum Mainnet' : `${ accountState.chainId } (Wrong Network)`}</strong>
					</div>
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
				</div>
			</article>
		</section>
	)
}
