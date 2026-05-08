import type { StickyContextItem } from '../types/components.js'

type StickyObjectContextProps = {
	eyebrow?: string
	items: StickyContextItem[]
	title: string
}

export function StickyObjectContext({ eyebrow, items, title }: StickyObjectContextProps) {
	return (
		<section className='sticky-object-context'>
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
		</section>
	)
}
