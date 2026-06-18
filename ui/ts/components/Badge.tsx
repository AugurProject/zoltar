import type { ComponentChildren } from 'preact'
import type { BadgeTone } from '../types/components.js'

type BadgeProps = {
	children: ComponentChildren
	className?: string
	tone?: BadgeTone
}

function getBadgeToneClass(tone: BadgeTone) {
	if (tone === 'danger') return 'blocked'
	if (tone === 'warning') return 'pending'
	return tone
}

export function Badge({ children, className = '', tone = 'muted' }: BadgeProps) {
	const toneClass = getBadgeToneClass(tone)
	const classes = ['badge', toneClass, className].filter(Boolean).join(' ')

	return <span className={classes}>{children}</span>
}
