import type { BrowserWindow, Element } from 'happy-dom'

export function element<T extends Element>(window: BrowserWindow, id: string, elementConstructor: { new (): T }): T {
	const found = window.document.getElementById(id)
	if (!(found instanceof elementConstructor)) throw new Error(`Missing dashboard element ${id}`)
	return found
}

export async function acceptOperatorDialog(window: BrowserWindow, phrase?: string) {
	let dialog: Element | null = null
	for (let attempt = 0; attempt < 100 && dialog === null; attempt++) {
		dialog = window.document.querySelector('.operator-confirm-dialog')
		if (dialog === null) await Bun.sleep(10)
	}
	if (dialog === null) throw new Error('Expected operator confirmation dialog')
	if (phrase !== undefined) {
		const input = element(window, 'operator-confirm-phrase', window.HTMLInputElement)
		input.value = phrase
		input.dispatchEvent(new window.Event('input', { bubbles: true }))
	}
	const confirm = element(window, 'operator-confirm-submit', window.HTMLButtonElement)
	for (let attempt = 0; attempt < 100 && confirm.disabled; attempt++) await Bun.sleep(10)
	confirm.click()
}
