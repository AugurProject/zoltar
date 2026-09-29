/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import type { Signal } from '@preact/signals'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

type CopyHook = {
	copied: Signal<boolean>
	copyError: Signal<string | undefined>
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

	async function mountCopyHook() {
		let hook: CopyHook | undefined
		function Probe() {
			hook = useCopyToClipboard()
			return (
				<output data-testid='copied'>
					{hook.copied.value ? 'copied' : 'not-copied'}
					{hook.copyError.value}
				</output>
			)
		}
		const renderedComponent = await renderIntoDocument(<Probe />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const activeHook = hook
		if (activeHook === undefined) throw new Error('hook did not mount')
		return { activeHook, renderedComponent }
	}

	/** Replaces the window timers with recorders; scheduled callbacks run only when a test invokes them. */
	function recordTimers() {
		const timeoutCallbacks: Array<() => void> = []
		const clearTimeoutIds: number[] = []
		let nextTimerId = 1
		window.setTimeout = ((callback: TimerHandler) => {
			timeoutCallbacks.push(() => {
				if (typeof callback === 'function') callback()
			})
			return nextTimerId++ as unknown as number
		}) as typeof window.setTimeout
		window.clearTimeout = ((id: number) => {
			clearTimeoutIds.push(id)
		}) as typeof window.clearTimeout
		return { clearTimeoutIds, timeoutCallbacks }
	}

	test('sets copied state to true during the success path and clears timeout on unmount', async () => {
		setClipboardWriteText(async () => undefined)
		const { clearTimeoutIds, timeoutCallbacks } = recordTimers()
		const { activeHook, renderedComponent } = await mountCopyHook()
		expect(timeoutCallbacks).toHaveLength(0)

		await act(async () => {
			await activeHook.copyText('copiable')
		})
		expect(activeHook.copied.value).toBe(true)
		expect(timeoutCallbacks).toHaveLength(1)
		await renderedComponent.cleanup()
		cleanupRenderedComponent = undefined
		expect(clearTimeoutIds.length).toBeGreaterThanOrEqual(1)
	})

	test('fires the reset timeout callback and sets copied state to false after success', async () => {
		setClipboardWriteText(async () => undefined)
		const { timeoutCallbacks } = recordTimers()
		const { activeHook } = await mountCopyHook()
		expect(timeoutCallbacks).toHaveLength(0)

		await act(async () => {
			await activeHook.copyText('copiable')
		})
		expect(activeHook.copied.value).toBe(true)
		expect(timeoutCallbacks).toHaveLength(1)
		await act(() => {
			timeoutCallbacks[0]?.()
		})
		expect(activeHook.copied.value).toBe(false)
	})

	test('clears an existing reset timeout on clipboard errors', async () => {
		setClipboardWriteText(async () => undefined)
		const { clearTimeoutIds } = recordTimers()
		const { activeHook } = await mountCopyHook()

		await act(async () => {
			await activeHook.copyText('good')
		})
		expect(activeHook.copied.value).toBe(true)

		setClipboardWriteText(async () => {
			throw new DOMException('copy blocked', 'NotAllowedError')
		})

		await act(async () => {
			await activeHook.copyText('blocked')
		})
		expect(activeHook.copied.value).toBe(false)
		expect(activeHook.copyError.value).toBe('Copy failed — select the value and copy it manually.')
		expect(clearTimeoutIds.length).toBeGreaterThanOrEqual(1)
	})

	test.each([
		{
			name: 'an unavailable clipboard API',
			installClipboard: () => {
				Reflect.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
				hasClipboardOverride = true
			},
		},
		{
			name: 'ordinary clipboard implementation failures',
			installClipboard: () =>
				setClipboardWriteText(async () => {
					throw new Error('unexpected clipboard implementation failure')
				}),
		},
	])('reports $name without rejecting', async ({ installClipboard }) => {
		installClipboard()
		const { activeHook } = await mountCopyHook()

		await expect(activeHook.copyText('copy me')).resolves.toBeUndefined()
		expect(activeHook.copyError.value).toBe('Copy failed — select the value and copy it manually.')
	})

	test('does not hide timer failures after a successful clipboard write', async () => {
		setClipboardWriteText(async () => undefined)
		const { activeHook } = await mountCopyHook()
		const timerError = new Error('timer failed')
		window.setTimeout = ((_handler: TimerHandler, _timeout?: number): number => {
			throw timerError
		}) as typeof window.setTimeout

		await expect(
			act(async () => {
				await activeHook.copyText('copy me')
			}),
		).rejects.toBe(timerError)
		expect(activeHook.copyError.value).toBeUndefined()
	})
})
