import { render, type ComponentChild } from 'preact'
import { act } from 'preact/test-utils'

export async function renderIntoDocument(node: ComponentChild) {
	const container = document.createElement('div')
	document.body.appendChild(container)
	await act(() => render(node, container))
	return {
		container,
		cleanup: async () => {
			await act(() => render(null, container))
			container.remove()
		},
	}
}
