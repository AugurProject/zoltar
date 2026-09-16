import type { ComponentChildren, RefObject } from 'preact'
import type { StickyContextItem } from '../types/components.js'

type StickyObjectContextProps = {
	badge?: ComponentChildren
	children?: ComponentChildren
	eyebrow?: string
	items: StickyContextItem[]
	sticky?: boolean
	title: string
	/** When provided, the title heading becomes a programmatic focus target (`tabIndex={-1}`) so callers can move focus to a changed object. */
	titleRef?: RefObject<HTMLHeadingElement>
	variant?: 'context-strip' | 'default' | 'embedded-context-strip'
}

export function StickyObjectContext({ badge, children, eyebrow, items, sticky = true, title, titleRef, variant = 'default' }: StickyObjectContextProps) {
	const classes = ['sticky-object-context', sticky ? '' : 'static', variant === 'context-strip' || variant === 'embedded-context-strip' ? 'context-strip' : '', variant === 'embedded-context-strip' ? 'embedded-context-strip' : ''].filter(Boolean).join(' ')

	return (
		<section className={classes}>
			<div className='sticky-object-context-summary'>
				<div className='sticky-object-context-header'>
					<div className='sticky-object-context-copy'>
						{eyebrow === undefined ? undefined : <p className='panel-label'>{eyebrow}</p>}
						{titleRef === undefined ? (
							<h3>{title}</h3>
						) : (
							<h3 ref={titleRef} tabIndex={-1}>
								{title}
							</h3>
						)}
					</div>
					{badge === undefined ? undefined : <div className='sticky-object-context-badge'>{badge}</div>}
				</div>
				{items.length === 0 ? undefined : (
					<div className='sticky-object-context-items'>
						{items.map(item => (
							<div key={`${item.label}`} className='sticky-object-context-item'>
								<span>{item.label}</span>
								<strong>{item.value}</strong>
							</div>
						))}
					</div>
				)}
			</div>
			{children === undefined ? undefined : <div className='sticky-object-context-body'>{children}</div>}
		</section>
	)
}
