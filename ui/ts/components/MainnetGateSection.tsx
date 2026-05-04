import { RouteHeader } from './RouteHeader.js'
import { SectionBlock } from './SectionBlock.js'
import type { MainnetGateSectionProps } from '../types/components.js'

export function MainnetGateSection({ message }: MainnetGateSectionProps) {
	return (
		<>
			<RouteHeader eyebrow='Network' title='Switch to Ethereum mainnet' description={message} />
			<SectionBlock tone='critical' description='This interface only enables contract interactions on Ethereum mainnet.'>
				<p className='detail'>Switch the connected wallet network to Ethereum mainnet to continue.</p>
			</SectionBlock>
		</>
	)
}
