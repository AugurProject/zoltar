// Installs browser globals for DOM-dependent unit tests and returns a function that restores the originals.
export const overrideGlobals = (values: Record<string, unknown>): (() => void) => {
	const originals = new Map<string, PropertyDescriptor | undefined>()
	for (const [key, value] of Object.entries(values)) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, { configurable: true, value })
	}
	return () => {
		for (const [key, descriptor] of originals) {
			if (descriptor === undefined) Reflect.deleteProperty(globalThis, key)
			else Object.defineProperty(globalThis, key, descriptor)
		}
	}
}
