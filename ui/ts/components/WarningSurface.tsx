import type { ComponentChildren, JSX } from 'preact'

type WarningSurfaceProps = {
	ariaLive?: 'assertive' | 'polite'
	as?: 'article' | 'div' | 'section'
	children: ComponentChildren
	className?: string
	role?: JSX.AriaRole | undefined
	variant?: 'compact' | 'default'
}

export function WarningSurface({ ariaLive, as = 'section', children, className = '', role, variant = 'default' }: WarningSurfaceProps) {
	const Tag = as
	const classes = ['warning-surface', variant === 'compact' ? 'compact' : undefined, className].filter(Boolean).join(' ')

	return (
		<Tag className={classes} role={role} aria-live={ariaLive}>
			{children}
		</Tag>
	)
}
