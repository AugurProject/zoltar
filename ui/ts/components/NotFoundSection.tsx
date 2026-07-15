import * as appCopy from '../copy/app.js'
import * as commonCopy from '../copy/common.js'
import { RouteHeader } from './RouteHeader.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { getPageNotFoundPresentation } from '../lib/userCopy.js'

export function NotFoundSection() {
	const presentation = getPageNotFoundPresentation()

	return (
		<>
			<RouteHeader eyebrow={appCopy.augurPlaceholder} title={appCopy.error404} description={appCopy.missingRouteDetail} />
			<SectionBlock className='not-found-shell' title={appCopy.hashRouteNotFound} description={appCopy.unsupportedRouteHint}>
				<div className='not-found-copy'>
					<StateHint presentation={presentation} />
					<div className='hero-status'>
						<span className='status-chip ready'>{commonCopy.pageNotFound}</span>
						<span className='status-chip muted'>{appCopy.hashNavigation}</span>
						<span className='status-chip muted'>{appCopy.mainnetConsole}</span>
					</div>
				</div>
				<div className='actions'>
					<a className='button-link' href='#/deploy'>
						{appCopy.returnToDeploy}
					</a>
					<a className='button-link secondary-link' href='#/zoltar'>
						{appCopy.openZoltar}
					</a>
					<a className='button-link secondary-link' href='#/security-pools'>
						{appCopy.openSecurityPools}
					</a>
				</div>
			</SectionBlock>
		</>
	)
}
