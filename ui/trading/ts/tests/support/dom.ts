import { act } from 'preact/test-utils'

/** Lets pending timers, effects, and chained promise callbacks run until the predicate holds, failing with the rendered text after about two seconds. */
export async function waitForDom(predicate: () => boolean, description: string) {
	for (let attempt = 0; attempt < 200; attempt++) {
		await act(async () => {
			await Bun.sleep(10)
		})
		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})
		if (predicate()) return
	}
	throw new Error(`Timed out waiting for ${description}. Rendered text: ${document.body.textContent}`)
}

/** The document button whose trimmed text is exactly the label. */
export function buttonByLabel(label: string) {
	const match = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent?.trim() === label)
	if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}. Rendered text: ${document.body.textContent}`)
	return match
}
