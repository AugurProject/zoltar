import { render, type ComponentChild } from 'preact'
import { act } from 'preact/test-utils'

type RenderIntoDocumentResult = {
	cleanup: () => Promise<void>
	unmount: () => Promise<void>
	container: HTMLDivElement
}

export async function renderIntoDocument(node: ComponentChild): Promise<RenderIntoDocumentResult> {
	const container = document.createElement('div')
	document.body.appendChild(container)
	await act(() => {
		render(node, container)
	})

	const unmount = async () => {
		await act(() => {
			render(null, container)
		})
		container.remove()
	}

	return {
		cleanup: unmount,
		unmount,
		container,
	}
}
