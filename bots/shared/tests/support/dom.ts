import { Window } from 'happy-dom'

const DOM_GLOBALS = [
	'window',
	'document',
	'Event',
	'Element',
	'HTMLElement',
	'HTMLAnchorElement',
	'HTMLButtonElement',
	'HTMLDetailsElement',
	'HTMLDialogElement',
	'HTMLFieldSetElement',
	'HTMLFormElement',
	'HTMLInputElement',
	'HTMLSelectElement',
	'HTMLTextAreaElement',
	'MutationObserver',
	'ResizeObserver',
	'getComputedStyle',
]

/** Installs a happy-dom window's DOM globals for one test and returns the window with a function that restores the previous globals. */
export function installDom(markup: string, url = 'http://127.0.0.1/settings') {
	const view = new Window({ url })
	const previous = DOM_GLOBALS.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
	for (const name of DOM_GLOBALS) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? view : Reflect.get(view, name) })
	view.document.body.innerHTML = markup
	return {
		view,
		restore: async () => {
			for (const [name, descriptor] of previous) {
				if (descriptor === undefined) Reflect.deleteProperty(globalThis, name)
				else Object.defineProperty(globalThis, name, descriptor)
			}
			await view.happyDOM.close()
		},
	}
}
