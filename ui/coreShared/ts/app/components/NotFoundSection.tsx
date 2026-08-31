import * as appCopy from '../../copy/app.js'
import { SectionBlock } from '../../components/SectionBlock.js'

export type NotFoundLink = {
	href: string
	label: string
}

export function NotFoundSection({ links }: { links: readonly NotFoundLink[] }) {
	return (
		<SectionBlock className='not-found-shell' title={appCopy.pageNotFoundTitle}>
			<div className='actions'>
				{links.map((link, index) => (
					<a className={index === 0 ? 'button-link' : 'button-link secondary-link'} href={link.href} key={link.href}>
						{link.label}
					</a>
				))}
			</div>
		</SectionBlock>
	)
}
