import type { RouteHeaderProps } from '../types/components.js'

export function RouteHeader({ actions, badge, className = '', description, eyebrow, summary, title, titleAside, titleRef }: RouteHeaderProps) {
	return (
		<header className={`route-header ${className}`.trim()}>
			<div className='route-header-main'>
				<div className='route-header-copy'>
					{eyebrow === undefined ? undefined : <p className='route-eyebrow'>{eyebrow}</p>}
					<div className={titleAside === undefined ? 'route-title-row' : 'route-title-row has-aside'}>
						{titleRef === undefined ? (
							<h2>{title}</h2>
						) : (
							<h2 ref={titleRef} tabIndex={-1}>
								{title}
							</h2>
						)}
						{titleAside === undefined ? undefined : <div className='route-title-aside'>{titleAside}</div>}
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
