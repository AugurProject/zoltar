/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { render } from 'preact'
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

	test('keeps the identifier visible and associates an announced clipboard error', async () => {
		const value = '0x0000000000000000000000000000000000000000000000000000000000000001'
		clipboardWriteText.mockImplementation(async () => {
			throw new DOMException('clipboard unavailable', 'NotAllowedError')
		})
		const renderedComponent = await renderIntoDocument(<IdentifierValue value={value} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		const copyButton = documentQueries.getByRole('button', { name: `Copy identifier ${value}` })

		await act(() => {
			fireEvent.click(copyButton)
		})
		const error = await waitFor(() => documentQueries.getByRole('alert'))
		expect(copyButton.textContent).toBe(value)
		expect(error.textContent).toBe('Copy failed — select the value and copy it manually.')
		expect(copyButton.getAttribute('aria-describedby')).toBe(error.id)
		expect((documentQueries.getByLabelText('Exact value for manual copy') as HTMLInputElement).value).toBe(value)
	})

	test('clears a clipboard error when the identifier changes', async () => {
		const firstValue = '0x0000000000000000000000000000000000000000000000000000000000000001'
		const secondValue = '0x0000000000000000000000000000000000000000000000000000000000000002'
		clipboardWriteText.mockImplementation(async () => {
			throw new DOMException('clipboard unavailable', 'NotAllowedError')
		})
		const renderedComponent = await renderIntoDocument(<IdentifierValue value={firstValue} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: `Copy identifier ${firstValue}` }))
		})
		await waitFor(() => documentQueries.getByRole('alert'))

		await act(() => {
			render(<IdentifierValue value={secondValue} />, renderedComponent.container)
		})

		const nextCopyButton = documentQueries.getByRole('button', { name: `Copy identifier ${secondValue}` })
		expect(documentQueries.queryByRole('alert')).toBeNull()
		expect(nextCopyButton.hasAttribute('aria-describedby')).toBe(false)
	})

	test('ignores an in-flight clipboard failure after the identifier changes', async () => {
		const firstValue = '0x0000000000000000000000000000000000000000000000000000000000000001'
		const secondValue = '0x0000000000000000000000000000000000000000000000000000000000000002'
		let rejectFirstCopy: (reason: Error) => void = () => undefined
		clipboardWriteText.mockImplementation(
			() =>
				new Promise<undefined>((_resolve, reject) => {
					rejectFirstCopy = reject
				}),
		)
		const renderedComponent = await renderIntoDocument(<IdentifierValue value={firstValue} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		fireEvent.click(documentQueries.getByRole('button', { name: `Copy identifier ${firstValue}` }))
		await act(async () => {
			render(<IdentifierValue value={secondValue} />, renderedComponent.container)
			rejectFirstCopy(new DOMException('old clipboard failure', 'NotAllowedError'))
			await Promise.resolve()
		})

		const nextCopyButton = documentQueries.getByRole('button', { name: `Copy identifier ${secondValue}` })
		expect(documentQueries.queryByRole('alert')).toBeNull()
		expect(nextCopyButton.hasAttribute('aria-describedby')).toBe(false)
	})

	test('ignores an older clipboard failure after a newer copy succeeds', async () => {
		const value = '0x0000000000000000000000000000000000000000000000000000000000000001'
		let rejectFirstCopy: (reason: Error) => void = () => undefined
		let copyAttempt = 0
		clipboardWriteText.mockImplementation(() => {
			copyAttempt += 1
			if (copyAttempt > 1) return Promise.resolve(undefined)
			return new Promise<undefined>((_resolve, reject) => {
				rejectFirstCopy = reject
			})
		})
		const renderedComponent = await renderIntoDocument(<IdentifierValue value={value} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		const copyButton = documentQueries.getByRole('button', { name: `Copy identifier ${value}` })

		fireEvent.click(copyButton)
		await act(() => {
			fireEvent.click(copyButton)
		})
		await waitFor(() => expect(copyButton.textContent).toBe('Copied'))
		await act(async () => {
			rejectFirstCopy(new DOMException('older clipboard failure', 'NotAllowedError'))
			await Promise.resolve()
		})

		expect(copyButton.textContent).toBe('Copied')
		expect(documentQueries.queryByRole('alert')).toBeNull()
		expect(copyButton.hasAttribute('aria-describedby')).toBe(false)
	})
})
