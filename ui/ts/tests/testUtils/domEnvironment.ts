import { Window } from 'happy-dom'

type InstalledDomEnvironment = {
	cleanup: () => void
	window: Window
}

const GLOBAL_KEYS = [
	'window',
	'document',
	'navigator',
	'location',
	'history',
	'self',
	'Node',
	'Text',
	'Element',
	'HTMLElement',
	'HTMLButtonElement',
	'HTMLInputElement',
	'DocumentFragment',
	'SVGElement',
	'Event',
	'MouseEvent',
	'CustomEvent',
	'MutationObserver',
	'getComputedStyle',
	'requestAnimationFrame',
	'cancelAnimationFrame',
	'IS_REACT_ACT_ENVIRONMENT',
] as const

type GlobalKey = (typeof GLOBAL_KEYS)[number]

export function installDomEnvironment(url = 'http://localhost/#/open-oracle'): InstalledDomEnvironment {
	const window = new Window({
		url,
	})
	Reflect.set(window, 'SyntaxError', globalThis.SyntaxError)
	const globalObject = globalThis as typeof globalThis & Record<GlobalKey, unknown>
	const previousDescriptors = new Map<GlobalKey, PropertyDescriptor | undefined>()

	const assignGlobal = (key: GlobalKey, value: unknown) => {
		previousDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, {
			configurable: true,
			value,
			writable: true,
		})
	}

	assignGlobal('window', window)
	assignGlobal('document', window.document)
	assignGlobal('navigator', window.navigator)
	assignGlobal('location', window.location)
	assignGlobal('history', window.history)
	assignGlobal('self', window)
	assignGlobal('Node', window.Node)
	assignGlobal('Text', window.Text)
	assignGlobal('Element', window.Element)
	assignGlobal('HTMLElement', window.HTMLElement)
	assignGlobal('HTMLButtonElement', window.HTMLButtonElement)
	assignGlobal('HTMLInputElement', window.HTMLInputElement)
	assignGlobal('DocumentFragment', window.DocumentFragment)
	assignGlobal('SVGElement', window.SVGElement)
	assignGlobal('Event', window.Event)
	assignGlobal('MouseEvent', window.MouseEvent)
	assignGlobal('CustomEvent', window.CustomEvent)
	assignGlobal('MutationObserver', window.MutationObserver)
	assignGlobal('getComputedStyle', window.getComputedStyle.bind(window))
	assignGlobal('requestAnimationFrame', window.requestAnimationFrame.bind(window))
	assignGlobal('cancelAnimationFrame', window.cancelAnimationFrame.bind(window))
	assignGlobal('IS_REACT_ACT_ENVIRONMENT', true)

	return {
		cleanup: () => {
			window.close()
			for (const key of [...GLOBAL_KEYS].reverse()) {
				const descriptor = previousDescriptors.get(key)
				if (descriptor === undefined) {
					delete globalObject[key]
					continue
				}
				Object.defineProperty(globalThis, key, descriptor)
			}
		},
		window,
	}
}
