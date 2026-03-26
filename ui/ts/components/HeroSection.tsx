import type { HeroSectionProps } from '../types/components.js'

export function HeroSection({ accountAddress, isRefreshing, onRefresh, onConnect }: HeroSectionProps) {
	return (
		<section className="hero">
			<div>
				<p className="eyebrow">Wallet Dashboard</p>
				<h1>Augur PLACEHOLDER deployment console</h1>
				<p className="lede">Wallet, balances, and deployment state stay visible while you switch between contract deployment and market creation.</p>
			</div>
			<div className="actions">
				<button className="secondary" onClick={onRefresh} disabled={isRefreshing}>
					{isRefreshing ? 'Refreshing...' : 'Refresh'}
				</button>
				<button onClick={onConnect}>{accountAddress === undefined ? 'Connect Wallet' : 'Reconnect Wallet'}</button>
			</div>
		</section>
	)
}
