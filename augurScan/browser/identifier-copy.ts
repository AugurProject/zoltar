import { shortIdentifier } from './identifier-format.ts'

const feedbackMs = 2_000

/** A Copy button for an identifier; it reports the result visibly and to screen readers. */
export const identifierCopyButton = (value: string): HTMLSpanElement => {
	const control = document.createElement('span')
	control.className = 'identifier-copy'
	const button = document.createElement('button')
	button.type = 'button'
	button.className = 'identifier-copy-button'
	button.textContent = 'Copy'
	button.title = `Copy ${value}`
	// The visible label is the same on every button, so the accessible name says which identifier it copies.
	button.setAttribute('aria-label', `Copy ${shortIdentifier(value)}`)
	const status = document.createElement('span')
	status.className = 'sr-only'
	status.setAttribute('role', 'status')
	let resetTimer: number | undefined
	button.addEventListener('click', async () => {
		let copied = true
		try {
			await navigator.clipboard.writeText(value)
		} catch (error) {
			// The clipboard can be unavailable (insecure context) or denied; the button reports the failure instead.
			console.error(`Copy to clipboard failed (${error instanceof Error ? error.name : typeof error})`)
			copied = false
		}
		button.textContent = copied ? 'Copied' : 'Copy failed'
		status.textContent = copied ? `Copied ${shortIdentifier(value)}` : 'Could not copy the identifier'
		window.clearTimeout(resetTimer)
		resetTimer = window.setTimeout(() => {
			button.textContent = 'Copy'
			status.textContent = ''
		}, feedbackMs)
	})
	control.append(button, status)
	return control
}
