/**
 * Makes every HTML element report `clientWidth()` as its visible width and `scrollWidth` as its content width, so a tab
 * strip overflows the way the test needs; returns a function that restores the DOM's own width properties.
 */
export function stubElementWidths(clientWidth: () => number, scrollWidth: number) {
	const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
	const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
	Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: clientWidth })
	Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth })
	return () => {
		if (clientWidthDescriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
		else Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
		if (scrollWidthDescriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
		else Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidthDescriptor)
	}
}
