import * as commonCopy from '../copy/common.js'
import type { ComponentChildren } from 'preact'

type LoadingTextProps = {
	children?: ComponentChildren
	className?: string
}

export function isLoadingText(value: ComponentChildren): value is string {
	return typeof value === 'string' && /^\s*loading\b/i.test(value)
}

export function LoadingText({ children = commonCopy.loadingWithEllipsis, className = '' }: LoadingTextProps) {
	return (
		<span aria-live='polite' className={`loading-value ${className}`} role='status'>
			<span className='spinner' aria-hidden='true' />
			{children}
		</span>
	)
}

export function LoadingAwareText({ children }: { children: ComponentChildren }) {
	return isLoadingText(children) ? <LoadingText>{children}</LoadingText> : <>{children}</>
}
