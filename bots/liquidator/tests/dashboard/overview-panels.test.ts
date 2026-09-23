import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { renderOverviewAlerts } from '../../src/dashboard/overview-panels.ts'

async function alertRows(alerts: { message: string; severity: 'error' | 'warning' }[]) {
	const window = new Window()
	const previousDocument = Reflect.get(globalThis, 'document')
	const previousList = Reflect.get(globalThis, 'HTMLUListElement')
	try {
		Reflect.set(globalThis, 'document', window.document)
		Reflect.set(globalThis, 'HTMLUListElement', window.HTMLUListElement)
		window.document.body.innerHTML = '<ul id="operator-alerts"></ul>'
		renderOverviewAlerts({
			alerts,
			pendingTransactions: [{ hash: `0x${'1'.repeat(64)}`, label: 'Liquidate pool', mode: 'private', nonce: '8', submissionBlock: '100' }],
		})
		return [...window.document.querySelectorAll('#operator-alerts li')].map(row => ({ message: row.textContent ?? '', actionHref: row.querySelector('a')?.getAttribute('href') }))
	} finally {
		if (previousDocument === undefined) Reflect.deleteProperty(globalThis, 'document')
		else Reflect.set(globalThis, 'document', previousDocument)
		if (previousList === undefined) Reflect.deleteProperty(globalThis, 'HTMLUListElement')
		else Reflect.set(globalThis, 'HTMLUListElement', previousList)
		await window.happyDOM.close()
	}
}

test('recovery action belongs to the transaction alert when connectivity also degrades', async () => {
	const rows = await alertRows([
		{ message: 'RPC connectivity is degraded', severity: 'warning' },
		{ message: '1 transaction intent(s) require recovery before execution can continue', severity: 'error' },
	])
	expect(rows[0]?.actionHref).toBeUndefined()
	expect(rows[1]?.message).toContain('transaction intent(s) require recovery')
	expect(rows[1]?.actionHref).toBe('/operations#recovery')
})

test('recovery action gets its own row when the server omits a transaction alert', async () => {
	const rows = await alertRows([{ message: 'RPC connectivity is degraded', severity: 'warning' }])
	expect(rows[0]?.message).toContain('operator recovery')
	expect(rows[0]?.actionHref).toBe('/operations#recovery')
	expect(rows[1]?.actionHref).toBeUndefined()
})
