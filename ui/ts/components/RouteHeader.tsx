import type { RouteHeaderProps } from '../types/components.js'

export function RouteHeader({ actions, badge, description, eyebrow, summary, title }: RouteHeaderProps) {
	return (
		<header className='route-header'>
			<div className='route-header-main'>
				<div className='route-header-copy'>
					{eyebrow === undefined ? undefined : <p className='route-eyebrow'>{eyebrow}</p>}
					<div className='route-title-row'>
						<h2>{title}</h2>
					</div>
					{description === undefined ? undefined : <p className='detail route-description'>{description}</p>}
				</div>
				{badge === undefined ? undefined : <div className='route-header-badge'>{badge}</div>}
				{actions === undefined ? undefined : <div className='route-header-actions'>{actions}</div>}
			</div>
			{summary === undefined ? undefined : <div className='route-summary-strip'>{summary}</div>}
		</header>
	)
}
