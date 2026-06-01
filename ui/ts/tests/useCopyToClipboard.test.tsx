/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import type { Signal } from '@preact/signals'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

type CopyHook = {
	copied: Signal<boolean>
	copyText: (text: string) => Promise<void>
}

describe('useCopyToClipboard', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let originalSetTimeout = globalThis.setTimeout
	let originalClearTimeout = globalThis.clearTimeout
	let hasClipboardOverride = false

	beforeEach(() => {
		cleanupDom = installDomEnvironment().cleanup
		originalSetTimeout = window.setTimeout
		originalClearTimeout = window.clearTimeout
		hasClipboardOverride = false
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		if (hasClipboardOverride) {
			Reflect.deleteProperty(navigator, 'clipboard')
		}
		window.setTimeout = originalSetTimeout
		window.clearTimeout = originalClearTimeout
		cleanupDom?.()
		cleanupDom = undefined
	})

	function setClipboardWriteText(writeText: (text: string) => Promise<void>) {
		Reflect.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
			writable: true,
		})
		hasClipboardOverride = true
	}

	test('sets copied state to true during the success path and clears timeout on unmount', async () => {
		const timeoutCallbacks: Array<() => void> = []
		const clearTimeoutIds: number[] = []
		let nextTimerId = 1
		setClipboardWriteText(async () => undefined)
		window.setTimeout = ((callback: TimerHandler) => {
			timeoutCallbacks.push(() => {
				if (typeof callback === 'function') callback()
			})
			return nextTimerId++ as unknown as number
		}) as typeof window.setTimeout
		window.clearTimeout = ((id: number) => {
			clearTimeoutIds.push(id)
		}) as typeof window.clearTimeout

		let hook: CopyHook | undefined
		function Probe() {
			hook = useCopyToClipboard()
			return <output data-testid='copied'>{hook?.copied.value ? 'copied' : 'not-copied'}</output>
		}

		const renderedComponent = await renderIntoDocument(<Probe />)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(timeoutCallbacks).toHaveLength(0)
		if (hook === undefined) {
			throw new Error('hook did not mount')
		}

		await act(async () => {
			await hook.copyText('copiable')
		})
		expect(hook?.copied.value).toBe(true)
		expect(timeoutCallbacks).toHaveLength(1)
		expect(hook?.copied.value).toBe(true)
		await renderedComponent.cleanup()
		expect(clearTimeoutIds.length).toBeGreaterThanOrEqual(1)
		hook = undefined
		cleanupRenderedComponent = undefined
	})

	test('fires the reset timeout callback and sets copied state to false after success', async () => {
		const timeoutCallbacks: Array<() => void> = []
		let nextTimerId = 1
		const copyText = async () => undefined
		setClipboardWriteText(copyText)
		window.setTimeout = ((callback: TimerHandler) => {
			timeoutCallbacks.push(() => {
				if (typeof callback === 'function') callback()
			})
			return nextTimerId++ as unknown as number
		}) as typeof window.setTimeout

		let hook: CopyHook | undefined
		function Probe() {
			hook = useCopyToClipboard()
			return <output data-testid='copied'>{hook?.copied.value ? 'copied' : 'not-copied'}</output>
		}

		const renderedComponent = await renderIntoDocument(<Probe />)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(timeoutCallbacks).toHaveLength(0)
		if (hook === undefined) {
			throw new Error('hook did not mount')
		}

		await act(async () => {
			await hook.copyText('copiable')
		})
		expect(hook?.copied.value).toBe(true)
		expect(timeoutCallbacks).toHaveLength(1)
		await act(() => {
			timeoutCallbacks[0]?.()
		})
		expect(hook?.copied.value).toBe(false)
		await renderedComponent.cleanup()
		hook = undefined
		cleanupRenderedComponent = undefined
	})

	test('clears an existing reset timeout on clipboard errors', async () => {
		const clearTimeoutIds: number[] = []
		let nextTimerId = 1
		setClipboardWriteText(async () => undefined)
		window.setTimeout = ((callback: TimerHandler) => {
			nextTimerId += 1
			return nextTimerId as unknown as number
		}) as typeof window.setTimeout
		window.clearTimeout = ((id: number) => {
			clearTimeoutIds.push(id)
		}) as typeof window.clearTimeout

		let hook: CopyHook | undefined
		function Probe() {
			hook = useCopyToClipboard()
			return <output data-testid='copied'>{hook?.copied.value ? 'copied' : 'not-copied'}</output>
		}

		const renderedComponent = await renderIntoDocument(<Probe />)
		cleanupRenderedComponent = renderedComponent.cleanup

		if (hook === undefined) {
			throw new Error('hook did not mount')
		}

		await act(async () => {
			await hook.copyText('good')
		})
		expect(hook?.copied.value).toBe(true)

		setClipboardWriteText(async () => {
			throw new Error('copy blocked')
		})

		await act(async () => {
			await hook.copyText('blocked')
		})
		expect(hook?.copied.value).toBe(false)
		expect(clearTimeoutIds.length).toBeGreaterThanOrEqual(1)
		await renderedComponent.cleanup()
	})
})
