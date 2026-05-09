import type { ComponentChildren } from 'preact'
import type { StickyContextItem } from '../types/components.js'

type StickyObjectContextProps = {
	children?: ComponentChildren
	eyebrow?: string
	items: StickyContextItem[]
	sticky?: boolean
	title: string
}

export function StickyObjectContext({ children, eyebrow, items, sticky = true, title }: StickyObjectContextProps) {
	return (
		<section className={`sticky-object-context${sticky ? '' : ' static'}`}>
			<div className='sticky-object-context-copy'>
				{eyebrow === undefined ? undefined : <p className='panel-label'>{eyebrow}</p>}
				<h3>{title}</h3>
			</div>
			<div className='sticky-object-context-items'>
				{items.map(item => (
					<div key={`${item.label}`} className='sticky-object-context-item'>
						<span>{item.label}</span>
						<strong>{item.value}</strong>
					</div>
				))}
			</div>
			{children === undefined ? undefined : <div className='sticky-object-context-body'>{children}</div>}
		</section>
	)
}
