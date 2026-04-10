import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

export function useCopyToClipboard() {
	const copied = useSignal(false)
	const copyResetTimeout = useRef<number | undefined>(undefined)

	useEffect(
		() => () => {
			if (copyResetTimeout.current !== undefined) window.clearTimeout(copyResetTimeout.current)
		},
		[],
	)

	const copyText = async (text: string) => {
		try {
			if (copyResetTimeout.current !== undefined) window.clearTimeout(copyResetTimeout.current)
			await navigator.clipboard.writeText(text)
			copied.value = true
			copyResetTimeout.current = window.setTimeout(() => {
				copied.value = false
				copyResetTimeout.current = undefined
			}, 1200)
		} catch {
			copied.value = false
			if (copyResetTimeout.current !== undefined) {
				window.clearTimeout(copyResetTimeout.current)
				copyResetTimeout.current = undefined
			}
		}
	}

	return { copied, copyText }
}
