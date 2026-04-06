import type { ComponentChildren } from 'preact'
import { LoadingText } from './LoadingText.js'

type LoadableValueProps = {
	children: ComponentChildren
	loading: boolean
	placeholder?: ComponentChildren
}

export function LoadableValue({ children, loading, placeholder = 'Loading...' }: LoadableValueProps) {
	return loading ? <LoadingText>{placeholder}</LoadingText> : <>{children}</>
}
