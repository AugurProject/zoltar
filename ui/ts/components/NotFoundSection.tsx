import { RouteHeader } from './RouteHeader.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { getPageNotFoundPresentation } from '../lib/userCopy.js'

export function NotFoundSection() {
	const presentation = getPageNotFoundPresentation()

	return (
		<>
			<RouteHeader eyebrow='Augur PLACEHOLDER' title='404' description='That page is not here.' />
			<SectionBlock className='not-found-shell' title='Hash route not found' description='Use the main routes below to return to a supported workflow.'>
				<div className='not-found-copy'>
					<StateHint presentation={presentation} />
					<div className='hero-status'>
						<span className='status-chip ready'>Page not found</span>
						<span className='status-chip muted'>Hash navigation</span>
						<span className='status-chip muted'>Mainnet console</span>
					</div>
				</div>
				<div className='actions'>
					<a className='button-link' href='#/deploy'>
						Return to Deploy
					</a>
					<a className='button-link secondary-link' href='#/zoltar'>
						Open Zoltar
					</a>
					<a className='button-link secondary-link' href='#/security-pools'>
						Open Security Pools
					</a>
				</div>
			</SectionBlock>
		</>
	)
}
