import type { ComponentChildren } from 'preact'
import type { BadgeTone } from '../types/components.js'

type BadgeProps = {
	children: ComponentChildren
	className?: string
	tone?: BadgeTone
}

export function Badge({ children, className = '', tone = 'muted' }: BadgeProps) {
	const classes = ['badge', tone, className].filter(Boolean).join(' ')

	return <span className={classes}>{children}</span>
}
