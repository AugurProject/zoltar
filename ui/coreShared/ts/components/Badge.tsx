import type { ComponentChildren } from 'preact'
import type { BadgeTone } from '../types/components.js'

type BadgeProps = {
	ariaLabel?: string
	children: ComponentChildren
	className?: string
	/** Lets a control reference the badge as its disabled reason through `aria-describedby`. */
	id?: string | undefined
	title?: string
	tone?: BadgeTone
}

export function Badge({ ariaLabel, children, className = '', id, title, tone = 'muted' }: BadgeProps) {
	const classes = ['badge', tone, className].filter(Boolean).join(' ')

	return (
		<span aria-label={ariaLabel} className={classes} id={id} title={title}>
			{children}
		</span>
	)
}
