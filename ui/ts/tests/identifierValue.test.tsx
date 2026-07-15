/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { IdentifierValue } from '../components/IdentifierValue.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { fireEvent, waitFor, within } from './testUtils/queries.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('IdentifierValue', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restoreDomEnvironment: (() => void) | undefined
	let clipboardWriteText = mock(async () => undefined)

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		clipboardWriteText = mock(async () => undefined)
		Reflect.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: clipboardWriteText },
		})
		Reflect.defineProperty(domEnvironment.window.navigator, 'clipboard', {
			configurable: true,
			value: { writeText: clipboardWriteText },
		})
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders and copies the complete identifier without truncating it', async () => {
		const value = '0x0000000000000000000000000000000000000000000000000000000000000001'
		const renderedComponent = await renderIntoDocument(<IdentifierValue value={value} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const copyButton = within(document.body).getByRole('button', { name: `Copy identifier ${value}` })

		expect(copyButton.textContent).toBe(value)
		expect(copyButton.classList.contains('identifier-value')).toBe(true)

		await act(() => {
			fireEvent.click(copyButton)
		})
		await waitFor(() => {
			expect(clipboardWriteText).toHaveBeenCalledWith(value)
			expect(copyButton.textContent).toBe('Copied')
		})
	})
})
