import type { ComponentChildren } from 'preact'
import { LoadingText } from './LoadingText.js'
import { TSX_STRINGS } from '../lib/uiStrings.js'

type LoadableValueProps = {
	children: ComponentChildren
	loading: boolean
	placeholder?: ComponentChildren
}

export function LoadableValue({ children, loading, placeholder = TSX_STRINGS.componentsLoadableValue.copy001 }: LoadableValueProps) {
	return loading ? <LoadingText>{placeholder}</LoadingText> : <>{children}</>
}
