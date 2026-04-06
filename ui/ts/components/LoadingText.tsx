import type { ComponentChildren } from 'preact'

type LoadingTextProps = {
	children?: ComponentChildren
	className?: string
}

export function LoadingText({ children = 'Loading...', className = '' }: LoadingTextProps) {
	return (
		<span className={`loading-value loading-text ${className}`}>
			<span className='spinner' aria-hidden='true' />
			{children}
		</span>
	)
}
