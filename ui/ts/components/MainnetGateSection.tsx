import type { MainnetGateSectionProps } from '../types/components.js'

export function MainnetGateSection({ message }: MainnetGateSectionProps) {
	return (
		<section class="panel market-panel">
			<div class="market-header">
				<div>
					<p class="panel-label">Wrong Network</p>
					<h2>Switch to Ethereum mainnet</h2>
					<p class="detail">{message}</p>
				</div>
			</div>
		</section>
	)
}
