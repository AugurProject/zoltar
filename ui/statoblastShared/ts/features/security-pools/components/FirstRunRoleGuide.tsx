import { useState } from 'preact/hooks'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import * as firstRunCopy from '../../../copy/firstRun.js'
import { firstRunRoles, persistFirstRunCardDismissed, readFirstRunCardDismissed } from '../lib/firstRunRoles.js'

/** Dismissible orientation for first-time visitors: one sentence and one guide link per role. */
export function FirstRunRoleGuide() {
	const [dismissed, setDismissed] = useState(() => readFirstRunCardDismissed(getBrowserStorage('localStorage')))
	if (dismissed) return undefined

	const dismiss = () => {
		persistFirstRunCardDismissed(getBrowserStorage('localStorage'))
		setDismissed(true)
	}

	return (
		<SectionBlock
			className='first-run-role-guide'
			title={firstRunCopy.firstRunTitle}
			variant='surface'
			actions={
				<button className='quiet' type='button' aria-label={firstRunCopy.dismissFirstRunLabel} onClick={dismiss}>
					{firstRunCopy.dismissFirstRun}
				</button>
			}
		>
			<ul className='first-run-roles'>
				{firstRunRoles.map(role => (
					<li className='first-run-role' key={role.id}>
						<strong className='first-run-role-title'>{role.title}</strong>
						<p className='detail'>{role.detail}</p>
						<a href={role.guideHref} target='_blank' rel='noreferrer'>
							{role.guideLabel}
						</a>
					</li>
				))}
			</ul>
		</SectionBlock>
	)
}
