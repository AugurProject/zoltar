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

/** `aria-current` needs the literal `page` value: an empty attribute reads as "not current" to both CSS and assistive technology. */
export function markCurrentPage(link: Element, current: boolean) {
	if (current) link.setAttribute('aria-current', 'page')
	else link.removeAttribute('aria-current')
}

/**
 * Height of the operator header while it is pinned to the viewport top, and zero while it scrolls with the page (as it
 * does on narrow viewports). Scroll offsets must clear only chrome that actually covers the content.
 */
export function stickyShellHeight(root: Document) {
	const shell = root.querySelector<HTMLElement>('.operator-shell')
	if (shell === null) return 0
	const position = root.defaultView?.getComputedStyle(shell).position
	return position === 'sticky' || position === 'fixed' ? shell.getBoundingClientRect().height : 0
}
