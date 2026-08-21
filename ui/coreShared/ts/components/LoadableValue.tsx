import * as commonCopy from '../copy/common.js'
import type { ComponentChildren } from 'preact'
import { LoadingText } from './LoadingText.js'

type LoadableValueProps = {
	children: ComponentChildren
	loading: boolean
	placeholder?: ComponentChildren
}

export function LoadableValue({ children, loading, placeholder = commonCopy.loadingWithEllipsis }: LoadableValueProps) {
	return loading ? <LoadingText>{placeholder}</LoadingText> : <>{children}</>
}
