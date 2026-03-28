import type { ComponentChildren } from 'preact'

type LoadableValueProps = {
	children: ComponentChildren
	loading: boolean
	placeholder?: ComponentChildren
}

export function LoadableValue({ children, loading, placeholder = 'Loading...' }: LoadableValueProps) {
	return loading ? <span className="loading-value">{placeholder}</span> : <>{children}</>
}
