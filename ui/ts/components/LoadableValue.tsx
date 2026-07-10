import type { ComponentChildren } from 'preact'
import { LoadingText } from './LoadingText.js'
import { UI_STRING_LOADING_WITH_ELLIPSIS } from '../lib/uiStrings.js'

type LoadableValueProps = {
	children: ComponentChildren
	loading: boolean
	placeholder?: ComponentChildren
}

export function LoadableValue({ children, loading, placeholder = UI_STRING_LOADING_WITH_ELLIPSIS }: LoadableValueProps) {
	return loading ? <LoadingText>{placeholder}</LoadingText> : <>{children}</>
}
