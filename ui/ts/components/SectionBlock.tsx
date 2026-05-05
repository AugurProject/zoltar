import type { SectionBlockProps } from '../types/components.js'

export function SectionBlock({ actions, badge, children, className = '', description, density = 'balanced', headingLevel = 3, title, tone = 'default', variant = 'default' }: SectionBlockProps) {
	const HeadingTag = headingLevel === 4 ? 'h4' : 'h3'
	const classes = ['section-block', `tone-${tone}`, `density-${density}`, variant, className].filter(Boolean).join(' ')

	return (
		<section className={classes}>
			{title === undefined && badge === undefined && actions === undefined && description === undefined ? undefined : (
				<div className='section-block-header'>
					<div className='section-block-copy'>
						<div className='section-block-title-row'>
							{title === undefined ? undefined : <HeadingTag>{title}</HeadingTag>}
							{badge === undefined ? undefined : <div className='section-block-badge'>{badge}</div>}
						</div>
						{description === undefined ? undefined : <p className='detail'>{description}</p>}
					</div>
					{actions === undefined ? undefined : <div className='section-block-actions'>{actions}</div>}
				</div>
			)}
			<div className='section-block-body'>{children}</div>
		</section>
	)
}
