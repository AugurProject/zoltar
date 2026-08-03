import { useSignal } from '@preact/signals'
import { useEffect, useId, useLayoutEffect, useRef } from 'preact/hooks'
import * as commonCopy from '../copy/common.js'

class ClipboardUnavailableError extends Error {}

export function useCopyToClipboard(valueKey?: string) {
	const copied = useSignal(false)
	const copyError = useSignal<string | undefined>(undefined)
	const copyErrorId = useId()
	const copyRequestGeneration = useRef(0)
	const copyResetTimeout = useRef<number | undefined>(undefined)
	const currentValueKey = useRef(valueKey)
	currentValueKey.current = valueKey

	useLayoutEffect(() => {
		copyRequestGeneration.current += 1
		copied.value = false
		copyError.value = undefined
		if (copyResetTimeout.current !== undefined) {
			window.clearTimeout(copyResetTimeout.current)
			copyResetTimeout.current = undefined
		}
	}, [valueKey])

	useEffect(
		() => () => {
			copyRequestGeneration.current += 1
			if (copyResetTimeout.current !== undefined) window.clearTimeout(copyResetTimeout.current)
		},
		[],
	)

	const copyText = async (text: string) => {
		copyRequestGeneration.current += 1
		const requestGeneration = copyRequestGeneration.current
		const requestValueKey = valueKey
		const isCurrentRequest = () => requestGeneration === copyRequestGeneration.current && requestValueKey === currentValueKey.current
		copied.value = false
		copyError.value = undefined
		if (copyResetTimeout.current !== undefined) {
			window.clearTimeout(copyResetTimeout.current)
			copyResetTimeout.current = undefined
		}
		try {
			const clipboard = navigator.clipboard
			if (clipboard === undefined || typeof clipboard.writeText !== 'function') throw new ClipboardUnavailableError('Clipboard API is unavailable')
			await clipboard.writeText(text)
			if (!isCurrentRequest()) return
			copied.value = true
			copyResetTimeout.current = window.setTimeout(() => {
				if (!isCurrentRequest()) return
				copied.value = false
				copyResetTimeout.current = undefined
			}, 1200)
		} catch {
			if (!isCurrentRequest()) return
			copied.value = false
			copyError.value = commonCopy.copyFailed
			if (copyResetTimeout.current !== undefined) {
				window.clearTimeout(copyResetTimeout.current)
				copyResetTimeout.current = undefined
			}
		}
	}

	return { copied, copyError, copyErrorId, copyText }
}
