import type { ComponentChildren } from 'preact'

type WarningSurfaceProps = {
	as?: 'article' | 'div' | 'section'
	children: ComponentChildren
	className?: string
	variant?: 'compact' | 'default'
}

export function WarningSurface({ as = 'section', children, className = '', variant = 'default' }: WarningSurfaceProps) {
	const Tag = as
	const classes = ['warning-surface', variant === 'compact' ? 'compact' : undefined, className].filter(Boolean).join(' ')

	return <Tag className={classes}>{children}</Tag>
}
