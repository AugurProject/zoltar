import { useState } from 'preact/hooks'
import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import * as firstRunCopy from '../../../copy/firstRun.js'
import { firstRunRoles, persistFirstRunCardDismissed, readFirstRunCardDismissed } from '../lib/firstRunRoles.js'

/** Dismissible orientation for first-time visitors: one guide link per role. */
export function FirstRunRoleGuide() {
	const [dismissed, setDismissed] = useState(() => readFirstRunCardDismissed(getBrowserStorage('localStorage')))
	if (dismissed) return undefined

	const dismiss = () => {
		persistFirstRunCardDismissed(getBrowserStorage('localStorage'))
		setDismissed(true)
	}

	// One line above the pool list: each role with the guide that explains it.
	return (
		<section className='first-run-role-guide' aria-labelledby='first-run-role-guide-heading'>
			<h3 id='first-run-role-guide-heading'>{firstRunCopy.firstRunTitle}</h3>
			<ul className='first-run-roles'>
				{firstRunRoles.map(role => (
					<li className='first-run-role' key={role.id}>
						<span className='first-run-role-title'>{role.title}</span>
						<a href={role.guideHref} target='_blank' rel='noreferrer'>
							{role.guideLabel}
						</a>
					</li>
				))}
			</ul>
			<button className='quiet' type='button' aria-label={firstRunCopy.dismissFirstRunLabel} onClick={dismiss}>
				{firstRunCopy.dismissFirstRun}
			</button>
		</section>
	)
}
