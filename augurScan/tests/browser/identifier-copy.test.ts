import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { createOperationsComponents } from '../../browser/operations-components.ts'
import { overrideGlobals } from '../support/global-overrides.ts'

const hash = `0x${'ab'.repeat(32)}`

const withDocument = async (run: (browser: Window) => Promise<void> | void): Promise<void> => {
	const browser = new Window({ url: 'https://scanner.test/operations/reports' })
	const restoreGlobals = overrideGlobals({ window: browser, document: browser.document, navigator: browser.navigator, HTMLAnchorElement: browser.HTMLAnchorElement })
	try {
		await run(browser)
	} finally {
		restoreGlobals()
		await browser.happyDOM.close()
	}
}

test('a shortened identifier in an operations row keeps its full value and offers a copy button outside links', async () => {
	await withDocument(async browser => {
		const { operationRow } = createOperationsComponents()
		const row = operationRow('ReportDisputed', 'Round 2', hash, '10')
		document.body.append(row)
		const code = row.querySelector('code')
		expect(code?.textContent).toBe('0xababababab…abababab')
		expect(code?.title).toBe(hash)
		const button = row.querySelector('button')
		if (button === null) throw new Error('Copy button is missing')
		expect(button.getAttribute('aria-label')).toBe('Copy 0xababab…ababab')
		button.click()
		await Bun.sleep(0)
		expect(await browser.navigator.clipboard.readText()).toBe(hash)
		expect(button.textContent).toBe('Copied')
		expect(row.querySelector('[role="status"]')?.textContent).toBe('Copied 0xababab…ababab')
	})
})

test('linked rows and short values carry no copy button', async () => {
	await withDocument(() => {
		const { operationRow } = createOperationsComponents()
		const linked = operationRow('Pool', 'Healthy', hash, undefined, '/pool/0x1')
		expect(linked.querySelector('code')?.title).toBe(hash)
		expect(linked.querySelector('button')).toBeNull()
		const short = operationRow('24-hour TWAP', 'Stable', 'NO per YES', undefined)
		expect(short.querySelector('code')?.textContent).toBe('NO per YES')
		expect(short.querySelector('code')?.hasAttribute('title')).toBe(false)
		expect(short.querySelector('button')).toBeNull()
	})
})
