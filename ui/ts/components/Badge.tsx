import type { ComponentChildren } from 'preact'
import type { BadgeTone } from '../types/components.js'

type BadgeProps = {
	ariaLabel?: string
	children: ComponentChildren
	className?: string
	title?: string
	tone?: BadgeTone
}

export function Badge({ ariaLabel, children, className = '', title, tone = 'muted' }: BadgeProps) {
	const classes = ['badge', tone, className].filter(Boolean).join(' ')

	return (
		<span aria-label={ariaLabel} className={classes} title={title}>
			{children}
		</span>
	)
}
