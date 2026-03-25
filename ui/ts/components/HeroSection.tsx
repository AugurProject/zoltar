import type { HeroSectionProps } from '../types/components.js'

export function HeroSection({ accountAddress, isRefreshing, onRefresh, onConnect }: HeroSectionProps) {
	return (
		<section class="hero">
			<div>
				<p class="eyebrow">Wallet Dashboard</p>
				<h1>Augur PLACEHOLDER deployment console</h1>
				<p class="lede">Wallet, balances, and deployment state stay visible while you switch between contract deployment and market creation.</p>
			</div>
			<div class="actions">
				<button class="secondary" onClick={onRefresh} disabled={isRefreshing}>
					{isRefreshing ? 'Refreshing...' : 'Refresh'}
				</button>
				<button onClick={onConnect}>{accountAddress === null ? 'Connect Wallet' : 'Reconnect Wallet'}</button>
			</div>
		</section>
	)
}
