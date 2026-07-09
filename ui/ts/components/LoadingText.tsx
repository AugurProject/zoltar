import type { ComponentChildren } from 'preact'
import { TSX_STRINGS } from '../lib/uiStrings.js'

type LoadingTextProps = {
	children?: ComponentChildren
	className?: string
}

export function LoadingText({ children = TSX_STRINGS.componentsLoadingText.copy001, className = '' }: LoadingTextProps) {
	return (
		<span className={`loading-value ${className}`}>
			<span className='spinner' aria-hidden='true' />
			{children}
		</span>
	)
}
