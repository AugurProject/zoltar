import * as commonCopy from '../copy/common.js'
import type { ComponentChildren } from 'preact'

type LoadingTextProps = {
	children?: ComponentChildren
	className?: string
}

export function LoadingText({ children = commonCopy.loadingWithEllipsis, className = '' }: LoadingTextProps) {
	return (
		<span className={`loading-value ${className}`}>
			<span className='spinner' aria-hidden='true' />
			{children}
		</span>
	)
}
