import { RouteHeader } from './RouteHeader.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { getPageNotFoundPresentation } from '../lib/userCopy.js'
import { TSX_STRINGS } from '../lib/uiStrings.js'

export function NotFoundSection() {
	const presentation = getPageNotFoundPresentation()

	return (
		<>
			<RouteHeader eyebrow={TSX_STRINGS.componentsNotFoundSection.copy001} title={TSX_STRINGS.componentsNotFoundSection.copy002} description={TSX_STRINGS.componentsNotFoundSection.copy003} />
			<SectionBlock className='not-found-shell' title={TSX_STRINGS.componentsNotFoundSection.copy004} description={TSX_STRINGS.componentsNotFoundSection.copy005}>
				<div className='not-found-copy'>
					<StateHint presentation={presentation} />
					<div className='hero-status'>
						<span className='status-chip ready'>{TSX_STRINGS.componentsNotFoundSection.copy006}</span>
						<span className='status-chip muted'>{TSX_STRINGS.componentsNotFoundSection.copy007}</span>
						<span className='status-chip muted'>{TSX_STRINGS.componentsNotFoundSection.copy008}</span>
					</div>
				</div>
				<div className='actions'>
					<a className='button-link' href='#/deploy'>
						{TSX_STRINGS.componentsNotFoundSection.copy009}
					</a>
					<a className='button-link secondary-link' href='#/zoltar'>
						{TSX_STRINGS.componentsNotFoundSection.copy010}
					</a>
					<a className='button-link secondary-link' href='#/security-pools'>
						{TSX_STRINGS.componentsNotFoundSection.copy011}
					</a>
				</div>
			</SectionBlock>
		</>
	)
}
