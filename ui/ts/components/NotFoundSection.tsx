import { RouteHeader } from './RouteHeader.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { getPageNotFoundPresentation } from '../lib/userCopy.js'
import {
	UI_STRING_404,
	UI_STRING_AUGUR_PLACEHOLDER,
	UI_STRING_HASH_NAVIGATION,
	UI_STRING_HASH_ROUTE_NOT_FOUND,
	UI_STRING_MAINNET_CONSOLE,
	UI_STRING_OPEN_SECURITY_POOLS,
	UI_STRING_OPEN_ZOLTAR,
	UI_STRING_PAGE_NOT_FOUND,
	UI_STRING_RETURN_TO_DEPLOY,
	UI_STRING_THAT_PAGE_IS_NOT_HERE,
	UI_STRING_USE_THE_MAIN_ROUTES_BELOW_TO_RETURN_TO_A_SUPPORTED_PAGE,
} from '../lib/uiStrings.js'

export function NotFoundSection() {
	const presentation = getPageNotFoundPresentation()

	return (
		<>
			<RouteHeader eyebrow={UI_STRING_AUGUR_PLACEHOLDER} title={UI_STRING_404} description={UI_STRING_THAT_PAGE_IS_NOT_HERE} />
			<SectionBlock className='not-found-shell' title={UI_STRING_HASH_ROUTE_NOT_FOUND} description={UI_STRING_USE_THE_MAIN_ROUTES_BELOW_TO_RETURN_TO_A_SUPPORTED_PAGE}>
				<div className='not-found-copy'>
					<StateHint presentation={presentation} />
					<div className='hero-status'>
						<span className='status-chip ready'>{UI_STRING_PAGE_NOT_FOUND}</span>
						<span className='status-chip muted'>{UI_STRING_HASH_NAVIGATION}</span>
						<span className='status-chip muted'>{UI_STRING_MAINNET_CONSOLE}</span>
					</div>
				</div>
				<div className='actions'>
					<a className='button-link' href='#/deploy'>
						{UI_STRING_RETURN_TO_DEPLOY}
					</a>
					<a className='button-link secondary-link' href='#/zoltar'>
						{UI_STRING_OPEN_ZOLTAR}
					</a>
					<a className='button-link secondary-link' href='#/security-pools'>
						{UI_STRING_OPEN_SECURITY_POOLS}
					</a>
				</div>
			</SectionBlock>
		</>
	)
}
