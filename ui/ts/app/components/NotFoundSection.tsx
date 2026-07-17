import * as appCopy from '../../copy/app.js'
import * as commonCopy from '../../copy/common.js'
import { SectionBlock } from '../../components/SectionBlock.js'

export function NotFoundSection() {
	return (
		<SectionBlock className='not-found-shell' title={appCopy.pageNotFoundTitle}>
			<div className='actions'>
				<a className='button-link' href='#/deploy'>
					{commonCopy.deploy}
				</a>
				<a className='button-link secondary-link' href='#/zoltar'>
					{commonCopy.markets}
				</a>
				<a className='button-link secondary-link' href='#/security-pools'>
					{commonCopy.securityPools}
				</a>
			</div>
		</SectionBlock>
	)
}
