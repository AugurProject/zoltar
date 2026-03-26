import type { HeroSectionProps } from '../types/components.js'

export function HeroSection({ accountAddress, isRefreshing, onRefresh, onConnect }: HeroSectionProps) {
	return (
		<section className="hero">
			<div>
				<h1>Augur PLACEHOLDER</h1>
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
