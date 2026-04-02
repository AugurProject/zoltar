import type { MainnetGateSectionProps } from '../types/components.js'

export function MainnetGateSection({ message }: MainnetGateSectionProps) {
	return (
		<section className='panel market-panel'>
			<div className='market-header'>
				<div>
					<h2>Switch to Ethereum mainnet</h2>
					<p className='detail'>{message}</p>
				</div>
			</div>
		</section>
	)
}
