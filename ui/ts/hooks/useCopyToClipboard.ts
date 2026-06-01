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
			const clipboard = navigator.clipboard
			if (clipboard === undefined || typeof clipboard.writeText !== 'function') throw new Error('Clipboard API is unavailable')
			if (copyResetTimeout.current !== undefined) window.clearTimeout(copyResetTimeout.current)
			await clipboard.writeText(text)
			copied.value = true
			copyResetTimeout.current = window.setTimeout(() => {
				copied.value = false
				copyResetTimeout.current = undefined
			}, 1200)
		} catch (error) {
			if (!(error instanceof DOMException)) throw error
			copied.value = false
			if (copyResetTimeout.current !== undefined) {
				window.clearTimeout(copyResetTimeout.current)
				copyResetTimeout.current = undefined
			}
		}
	}

	return { copied, copyText }
}
