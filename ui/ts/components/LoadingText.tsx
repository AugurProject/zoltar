import * as commonCopy from '../copy/common.js'
import type { ComponentChildren } from 'preact'

type LoadingTextProps = {
	announce?: boolean
	children?: ComponentChildren
	className?: string
}

export function isLoadingText(value: ComponentChildren): value is string {
	return typeof value === 'string' && /^\s*loading\b/i.test(value)
}

export function LoadingText({ announce = true, children = commonCopy.loadingWithEllipsis, className = '' }: LoadingTextProps) {
	return (
		<span {...(announce ? { 'aria-live': 'polite' as const, role: 'status' as const } : {})} className={`loading-value ${className}`}>
			<span className='spinner' aria-hidden='true' />
			{children}
		</span>
	)
}

export function LoadingAwareText({ children }: { children: ComponentChildren }) {
	return isLoadingText(children) ? <LoadingText>{children}</LoadingText> : <>{children}</>
}
