import { act } from 'preact/test-utils'

type TextMatch = string | RegExp

type RoleOptions = {
	name?: TextMatch
	level?: number
}

type TextOptions = {
	selector?: string
}

type FireEventInit = Record<string, unknown>

function normalizeText(text: string): string {
	return text.replace(/\s+/g, ' ').trim()
}

function getRole(element: Element): string | null {
	const explicitRole = element.getAttribute('role')
	if (explicitRole) return explicitRole
	const tag = element.tagName.toLowerCase()
	switch (tag) {
		case 'button':
			return 'button'
		case 'a':
			return element.hasAttribute('href') ? 'link' : null
		case 'h1':
		case 'h2':
		case 'h3':
		case 'h4':
		case 'h5':
		case 'h6':
			return 'heading'
		case 'dialog':
			return 'dialog'
		case 'input': {
			const type = (element as HTMLInputElement).type
			if (type === 'range') return 'slider'
			if (type === 'checkbox') return 'checkbox'
			if (type === 'radio') return 'radio'
			return 'textbox'
		}
		case 'textarea':
			return 'textbox'
		case 'select':
			return 'combobox'
		case 'option':
			return 'option'
		case 'output':
			return 'status'
		default:
			return null
	}
}

function getLevel(element: Element): number | null {
	const tag = element.tagName.toLowerCase()
	if (tag === 'h1') return 1
	if (tag === 'h2') return 2
	if (tag === 'h3') return 3
	if (tag === 'h4') return 4
	if (tag === 'h5') return 5
	if (tag === 'h6') return 6
	return null
}

const consultedNodes = new WeakSet<Element>()

function getAccessibleName(element: Element): string {
	const ariaLabel = element.getAttribute('aria-label')
	if (ariaLabel) return normalizeText(ariaLabel)
	const ariaLabelledby = element.getAttribute('aria-labelledby')
	if (ariaLabelledby) {
		const labelElement = document.getElementById(ariaLabelledby)
		if (labelElement) return getAccessibleName(labelElement)
	}
	const labels = (element as HTMLElement & { labels?: NodeList }).labels
	if (labels !== undefined && labels !== null && labels.length > 0) {
		consultedNodes.add(element)
		const labelTexts: string[] = []
		const labelsArray = Array.from(labels)
		for (const label of labelsArray) {
			labelTexts.push(computeLabelTextForControl(label as Element, element))
		}
		consultedNodes.delete(element)
		return normalizeText(labelTexts.filter(t => t.length > 0).join(' '))
	}
	return normalizeText(element.textContent ?? '')
}

function computeLabelTextForControl(label: Element, control: Element): string {
	let result = ''
	const children = Array.from(label.childNodes)
	for (const child of children) {
		if (child === control) continue
		if (consultedNodes.has(child as Element)) continue
		if (child.nodeType === Node.ELEMENT_NODE) {
			const childEl = child as Element
			const tag = childEl.tagName.toLowerCase()
			if (tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select') {
				if (childEl === control) continue
				result += childEl.textContent ?? ''
			} else {
				result += computeLabelTextForControl(childEl, control)
			}
		} else if (child.nodeType === Node.TEXT_NODE) {
			result += child.textContent ?? ''
		}
	}
	return result.replace(/\s+/g, ' ').trim()
}

function matchesTargetText(elementText: string, match: TextMatch): boolean {
	const normalized = normalizeText(elementText)
	if (typeof match === 'string') {
		return normalized === normalizeText(match)
	}
	return match.test(normalized)
}

function findAllByRole(container: Element, role: string, options?: RoleOptions): Element[] {
	const allElements = Array.from(container.querySelectorAll('*'))
	return allElements.filter(el => {
		if (getRole(el) !== role) return false
		if (options?.level !== undefined && getLevel(el) !== options.level) return false
		if (options?.name !== undefined && !matchesTargetText(getAccessibleName(el), options.name)) return false
		return true
	})
}

function getNodeText(node: Element): string {
	return Array.from(node.childNodes)
		.filter(child => child.nodeType === Node.TEXT_NODE && Boolean(child.textContent))
		.map(c => c.textContent)
		.join('')
}

function findAllByText(container: Element, text: TextMatch, options?: TextOptions): Element[] {
	const selector = options?.selector ?? '*'
	const baseArray = typeof container.matches === 'function' && container.matches(selector) ? [container] : []
	return [...baseArray, ...Array.from(container.querySelectorAll(selector))].filter(node => matchesTargetText(getNodeText(node), text))
}

function getLabelText(labelEl: Element): string {
	let result = ''
	const children = Array.from(labelEl.childNodes)
	for (const child of children) {
		if (child.nodeType === Node.ELEMENT_NODE) {
			const childEl = child as Element
			const tag = childEl.tagName.toLowerCase()
			if (tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'output') {
				continue
			}
			result += getLabelText(childEl)
		} else if (child.nodeType === Node.TEXT_NODE) {
			result += child.textContent ?? ''
		}
	}
	return result.replace(/\s+/g, ' ').trim()
}

function findLabelElement(container: Element, label: TextMatch): Element | null {
	const ariaLabeled = Array.from(container.querySelectorAll('[aria-label]'))
	for (const el of ariaLabeled) {
		const al = el.getAttribute('aria-label') ?? ''
		if (matchesTargetText(al, label)) return el
	}
	const labels = Array.from(container.querySelectorAll('label'))
	for (const labelEl of labels) {
		if (!matchesTargetText(getLabelText(labelEl), label)) continue
		const forAttr = labelEl.getAttribute('for')
		if (forAttr) {
			const target = container.querySelector(`#${forAttr.replace(/[!"#$%&'()*+,./:;<=>?@[\]^`{|}~]/g, '\\$&')}`)
			if (target) return target
		}
		const labeledChild = labelEl.querySelector('input, textarea, select, button, output')
		if (labeledChild) return labeledChild
	}
	return null
}

function findPlaceholderElement(container: Element, text: TextMatch): Element | null {
	const els = Array.from(container.querySelectorAll('[placeholder]'))
	for (const el of els) {
		const placeholder = el.getAttribute('placeholder') ?? ''
		if (matchesTargetText(placeholder, text)) return el
	}
	return null
}

function findTestIdElement(container: Element, id: string): Element | null {
	return container.querySelector(`[data-testid="${id}"]`)
}

function findTitleElement(container: Element, text: TextMatch): Element | null {
	const els = Array.from(container.querySelectorAll('[title]'))
	for (const el of els) {
		const title = el.getAttribute('title') ?? ''
		if (matchesTargetText(title, text)) return el
	}
	return null
}

function firstOrThrow(elements: Element[], queryDescription: string): HTMLElement {
	const first = elements[0]
	if (first === undefined) throw new Error(`Unable to find an element: ${queryDescription}`)
	return first as HTMLElement
}

function getManyOrThrow(elements: Element[], queryDescription: string): HTMLElement[] {
	if (elements.length === 0) throw new Error(`Unable to find any elements: ${queryDescription}`)
	return elements as HTMLElement[]
}

function roleDescription(role: string, options?: RoleOptions): string {
	let desc = `role="${role}"`
	if (options?.name !== undefined) desc += `, name="${options.name}"`
	if (options?.level !== undefined) desc += `, level=${options.level}`
	return desc
}

function textDescription(text: TextMatch, options?: TextOptions): string {
	let desc = `text=${text}`
	if (options?.selector !== undefined) desc += `, selector="${options.selector}"`
	return desc
}

export function within(container: Element) {
	return {
		getByRole(role: string, options?: RoleOptions): HTMLElement {
			return firstOrThrow(findAllByRole(container, role, options), roleDescription(role, options))
		},
		queryByRole(role: string, options?: RoleOptions): HTMLElement | null {
			const results = findAllByRole(container, role, options)
			return (results[0] as HTMLElement) ?? null
		},
		getAllByRole(role: string, options?: RoleOptions): HTMLElement[] {
			return getManyOrThrow(findAllByRole(container, role, options), roleDescription(role, options))
		},
		getByText(text: TextMatch, options?: TextOptions): HTMLElement {
			return firstOrThrow(findAllByText(container, text, options), textDescription(text, options))
		},
		queryByText(text: TextMatch, options?: TextOptions): HTMLElement | null {
			const results = findAllByText(container, text, options)
			return (results[0] as HTMLElement) ?? null
		},
		getAllByText(text: TextMatch, options?: TextOptions): HTMLElement[] {
			return getManyOrThrow(findAllByText(container, text, options), textDescription(text, options))
		},
		queryAllByText(text: TextMatch): HTMLElement[] {
			return findAllByText(container, text) as HTMLElement[]
		},
		getByLabelText(label: TextMatch): HTMLElement {
			const result = findLabelElement(container, label)
			if (result === null) throw new Error(`Unable to find element with label: ${label}`)
			return result as HTMLElement
		},
		getByPlaceholderText(text: TextMatch): HTMLElement {
			const result = findPlaceholderElement(container, text)
			if (result === null) throw new Error(`Unable to find element with placeholder: ${text}`)
			return result as HTMLElement
		},
		getByTestId(id: string): HTMLElement {
			const result = findTestIdElement(container, id)
			if (result === null) throw new Error(`Unable to find element with data-testid: ${id}`)
			return result as HTMLElement
		},
		getByTitle(text: TextMatch): HTMLElement {
			const result = findTitleElement(container, text)
			if (result === null) throw new Error(`Unable to find element with title: ${text}`)
			return result as HTMLElement
		},
	}
}

function dispatchDomEvent(element: EventTarget, event: Event): void {
	void act(() => {
		element.dispatchEvent(event)
	})
}

function createKeyboardEvent(type: string, options?: KeyboardEventInit): Event {
	const KeyboardEventCtor = (globalThis as Record<string, unknown>)['KeyboardEvent'] as (new (type: string, init?: KeyboardEventInit) => Event) | undefined
	if (KeyboardEventCtor !== undefined) {
		return new KeyboardEventCtor(type, { bubbles: true, cancelable: true, ...options })
	}
	const event = new Event(type, { bubbles: true, cancelable: true })
	if (options?.key !== undefined) Object.defineProperty(event, 'key', { value: options.key })
	if (options?.shiftKey !== undefined) Object.defineProperty(event, 'shiftKey', { value: options.shiftKey })
	return event
}

function applyEventInit(element: EventTarget, init?: FireEventInit): void {
	const target = init?.['target'] as Record<string, unknown> | undefined
	if (target !== undefined) {
		for (const key of Object.keys(target)) {
			const value = target[key]
			if (value !== undefined) {
				;(element as unknown as Record<string, unknown>)[key] = value
			}
		}
	}
}

export const fireEvent = {
	click(element: EventTarget, options?: MouseEventInit): void {
		const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options })
		dispatchDomEvent(element, event)
	},
	input(element: EventTarget, init?: FireEventInit): void {
		applyEventInit(element, init)
		const event = new Event('input', { bubbles: true, cancelable: true })
		dispatchDomEvent(element, event)
	},
	change(element: EventTarget, init?: FireEventInit): void {
		applyEventInit(element, init)
		const event = new Event('change', { bubbles: true, cancelable: true })
		dispatchDomEvent(element, event)
	},
	keyDown(element: EventTarget, options?: KeyboardEventInit): void {
		dispatchDomEvent(element, createKeyboardEvent('keydown', options))
	},
	mouseDown(element: EventTarget, options?: MouseEventInit): void {
		const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, ...options })
		dispatchDomEvent(element, event)
	},
}

export async function waitFor<T>(callback: () => T, options?: { timeout?: number; interval?: number }): Promise<T> {
	const timeout = options?.timeout ?? 1000
	const interval = options?.interval ?? 50
	const start = Date.now()
	while (true) {
		try {
			return await callback()
		} catch (error) {
			if (Date.now() - start >= timeout) {
				throw error
			}
			await new Promise(resolve => setTimeout(resolve, interval))
		}
	}
}
