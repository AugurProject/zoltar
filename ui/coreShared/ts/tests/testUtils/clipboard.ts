type TestClipboard = { writeText: (text: string) => Promise<void> }

/** Installs `clipboard` on the global navigator and on the DOM window's navigator, so copy controls reach it either way. */
export function installClipboard(clipboard: TestClipboard, windowNavigator: Navigator = window.navigator) {
	Reflect.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
	Reflect.defineProperty(windowNavigator, 'clipboard', { configurable: true, value: clipboard })
}

/** A clipboard whose every write is refused, as when the browser denies clipboard permission. */
export function deniedClipboard(): TestClipboard {
	return {
		writeText: async () => {
			throw new DOMException('clipboard unavailable', 'NotAllowedError')
		},
	}
}
