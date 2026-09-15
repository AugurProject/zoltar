/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { useFocusOnKeyChange } from '../../features/live/useFocusOnKeyChange.js'

function FocusTarget({ focusOnFirstKey, keyValue }: { focusOnFirstKey: boolean; keyValue: string | undefined }) {
	const ref = useFocusOnKeyChange<HTMLDivElement>(keyValue, focusOnFirstKey)
	return (
		<div ref={ref} tabIndex={-1}>
			target
		</div>
	)
}

describe('useFocusOnKeyChange', () => {
	let cleanupRendered: (() => Promise<void>) | undefined
	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
	})

	test('ignores mount and undefined keys, skips the first key on request, then focuses on later changes', async () => {
		const rendered = await renderIntoDocument(<FocusTarget focusOnFirstKey={false} keyValue={undefined} />)
		cleanupRendered = rendered.cleanup
		const target = rendered.container.querySelector('div')
		if (target === null) throw new Error('Focus target is missing')
		expect(document.activeElement).not.toBe(target)
		await act(() => render(<FocusTarget focusOnFirstKey={false} keyValue='first' />, rendered.container))
		expect(document.activeElement).not.toBe(target)
		await act(() => render(<FocusTarget focusOnFirstKey={false} keyValue='second' />, rendered.container))
		expect(document.activeElement).toBe(target)
	})

	test('focuses on the first defined key by default', async () => {
		const rendered = await renderIntoDocument(<FocusTarget focusOnFirstKey keyValue={undefined} />)
		cleanupRendered = rendered.cleanup
		const target = rendered.container.querySelector('div')
		if (target === null) throw new Error('Focus target is missing')
		await act(() => render(<FocusTarget focusOnFirstKey keyValue='0xhash' />, rendered.container))
		expect(document.activeElement).toBe(target)
	})
})
