import type { ComponentChildren } from 'preact'
import { UI_STRING_LOADING_WITH_ELLIPSIS } from '../lib/uiStrings.js'

type LoadingTextProps = {
	children?: ComponentChildren
	className?: string
}

export function LoadingText({ children = UI_STRING_LOADING_WITH_ELLIPSIS, className = '' }: LoadingTextProps) {
	return (
		<span className={`loading-value ${className}`}>
			<span className='spinner' aria-hidden='true' />
			{children}
		</span>
	)
}
