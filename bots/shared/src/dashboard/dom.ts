/** DOM lookups shared by the bot dashboards; none of them read module state. */

export function element(id: string): HTMLElement
export function element<T extends HTMLElement>(id: string, constructor: { new (): T }): T
export function element(id: string, constructor: { new (): HTMLElement } = HTMLElement) {
	const found = document.getElementById(id)
	if (!(found instanceof constructor)) throw new Error(`Missing dashboard element: ${id}`)
	return found
}

export function setText(id: string, value: string) {
	const target = element(id)
	if (target.textContent !== value) target.textContent = value
}

export function shorten(value: string, leading = 8, trailing = 6) {
	return value.length <= leading + trailing + 1 ? value : `${value.slice(0, leading)}…${value.slice(-trailing)}`
}
