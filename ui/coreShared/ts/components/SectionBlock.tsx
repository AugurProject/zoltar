import type { SectionBlockProps } from '../types/components.js'

function getSectionBlockHeadingTag(headingLevel: SectionBlockProps['headingLevel']) {
	if (headingLevel === 2) return 'h2'
	if (headingLevel === 4) return 'h4'
	return 'h3'
}

export function SectionBlock({ actions, badge, children, className = '', description, density = 'balanced', headingLevel = 3, title, tone = 'default', variant = 'default' }: SectionBlockProps) {
	const HeadingTag = getSectionBlockHeadingTag(headingLevel)
	const classes = ['section-block', `tone-${tone}`, `density-${density}`, variant, className].filter(Boolean).join(' ')

	return (
		<section className={classes}>
			{title === undefined && badge === undefined && actions === undefined && description === undefined ? undefined : (
				<div className='section-block-header'>
					<div className='section-block-copy'>
						<div className='section-block-title-row'>{title === undefined ? undefined : <HeadingTag>{title}</HeadingTag>}</div>
						{description === undefined ? undefined : <p className='detail'>{description}</p>}
					</div>
					{badge === undefined ? undefined : <div className='section-block-badge'>{badge}</div>}
					{actions === undefined ? undefined : <div className='section-block-actions'>{actions}</div>}
				</div>
			)}
			<div className='section-block-body'>{children}</div>
		</section>
	)
}
