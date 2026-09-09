import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { OpenPoolForm } from '../../features/OpenPoolForm.js'
import { currentRoute, tradingDocumentTitle } from '../../app/App.js'

test('opens an addressed workflow and preserves simulation settings; rejects invalid addresses and locked navigation', async () => {
	const dom = installDomEnvironment('http://localhost/#/markets?simulate=1&simScenario=trading-funded')
	const rendered = await renderIntoDocument(<OpenPoolForm disabled={false} />)
	try {
		const input = rendered.container.querySelector('input')
		const button = rendered.container.querySelector('button')
		const form = rendered.container.querySelector('form')
		if (input === null || button === null || form === null) throw new Error('Address form did not render')
		expect(button.disabled).toBe(true)
		for (const invalid of ['hello', '0x0000000000000000000000000000000000000000']) {
			await act(() => {
				input.value = invalid
				input.dispatchEvent(new Event('input', { bubbles: true }))
			})
			expect(button.disabled).toBe(true)
			expect(input.getAttribute('aria-invalid')).toBe('true')
		}
		const pool = '0x1111111111111111111111111111111111111111'
		await act(() => {
			input.value = ` ${pool} `
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		expect(button.disabled).toBe(false)
		await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
		expect(currentRoute()).toBe(`market/${pool}`)
		expect(window.location.hash).toContain('simScenario=trading-funded')
		await act(() => render(<OpenPoolForm disabled={true} liquidity />, rendered.container))
		await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
		expect(currentRoute()).toBe(`market/${pool}`)
		await act(() => render(<OpenPoolForm disabled={false} liquidity />, rendered.container))
		await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
		expect(currentRoute()).toBe(`liquidity/${pool}`)
		expect(tradingDocumentTitle(`liquidity/${pool}`)).toBe('Liquidity · Statoblast trading')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})
