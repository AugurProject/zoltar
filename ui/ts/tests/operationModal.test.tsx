/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { OperationModal } from '../components/OperationModal.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'

function OperationModalHarness() {
	const [value, setValue] = useState('')

	return (
		<OperationModal isOpen onClose={() => undefined} title='Edit amount'>
			<label className='field'>
				<span>Amount</span>
				<input value={value} onInput={event => setValue(event.currentTarget.value)} />
			</label>
			<button type='button'>Confirm</button>
		</OperationModal>
	)
}

function DismissibleOperationModalHarness() {
	const [isOpen, setIsOpen] = useState(true)
	return (
		<div>
			{isOpen ? (
				<OperationModal
					isOpen
					onClose={() => {
						setIsOpen(false)
					}}
					title='Edit amount'
				>
					<label className='field'>
						<span>Amount</span>
						<input value='' />
					</label>
				</OperationModal>
			) : undefined}
		</div>
	)
}

function FocusRestoreModalHarness({ onOpenSetter }: { onOpenSetter: (setOpen: (open: boolean) => void) => void }) {
	const [isOpen, setIsOpen] = useState(false)
	const focusTargetRef = useRef<HTMLButtonElement | null>(null)
	useEffect(() => {
		onOpenSetter(setIsOpen)
	}, [onOpenSetter])

	return (
		<div>
			<button id='operation-modal-focus-target' ref={focusTargetRef} type='button'>
				Focus target
			</button>
			{isOpen ? (
				<OperationModal
					isOpen
					onClose={() => {
						setIsOpen(false)
					}}
					title='Edit amount'
				>
					<label className='field'>
						<span>Amount</span>
						<input value='' />
					</label>
					<button type='button'>Confirm</button>
				</OperationModal>
			) : undefined}
		</div>
	)
}

describe('OperationModal', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('exposes the dialog title and close control accessibly', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(<OperationModalHarness />, container)
		})

		const dialog = within(container).getByRole('dialog', { name: 'Edit amount' })
		const closeButton = within(dialog).getByRole('button', { name: 'Close' })

		expect(dialog).not.toBeNull()
		expect(closeButton.textContent).toBe('×')

		render(null, container)
		container.remove()
	})

	test('associates the optional description with the dialog', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)
		const description = 'Review the details before submitting.'

		await act(() => {
			render(
				<OperationModal isOpen onClose={() => undefined} title='Review Action' description={description}>
					<button type='button'>Confirm</button>
				</OperationModal>,
				container,
			)
		})

		const dialog = within(container).getByRole('dialog', { name: 'Review Action' })
		const descriptionId = dialog.getAttribute('aria-describedby')
		if (descriptionId === null) throw new Error('Expected dialog description id')
		const descriptionElement = document.getElementById(descriptionId)
		expect(descriptionElement?.textContent).toBe(description)

		render(null, container)
		container.remove()
	})

	test('uses unique title and description ids for multiple open dialogs', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(
				<>
					<OperationModal isOpen onClose={() => undefined} title='First action' description='First action details'>
						<button type='button'>Confirm first</button>
					</OperationModal>
					<OperationModal isOpen onClose={() => undefined} title='Second action' description='Second action details'>
						<button type='button'>Confirm second</button>
					</OperationModal>
				</>,
				container,
			)
		})

		const dialogs = within(container).getAllByRole('dialog')
		const labelledByIds = dialogs.map(dialog => dialog.getAttribute('aria-labelledby'))
		const describedByIds = dialogs.map(dialog => dialog.getAttribute('aria-describedby'))

		expect(new Set(labelledByIds).size).toBe(2)
		expect(new Set(describedByIds).size).toBe(2)

		for (const id of [...labelledByIds, ...describedByIds]) {
			if (id === null) throw new Error('Expected dialog accessibility id')
			expect(document.getElementById(id)).not.toBeNull()
		}

		expect(within(container).getByRole('dialog', { name: 'First action' }).getAttribute('aria-describedby')).not.toBe(within(container).getByRole('dialog', { name: 'Second action' }).getAttribute('aria-describedby'))

		render(null, container)
		container.remove()
	})

	test('keeps focus on input while the modal rerenders and wraps focus on Tab', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(<OperationModalHarness />, container)
		})

		const dialog = within(container).getByRole('dialog', { name: 'Edit amount' })
		const amountInput = within(dialog).getByLabelText('Amount') as HTMLInputElement
		const confirmButton = within(dialog).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
		const closeButton = within(dialog).getByRole('button', { name: 'Close' }) as HTMLButtonElement

		expect(document.activeElement).toBe(closeButton)

		await act(() => {
			fireEvent.keyDown(closeButton, { key: 'Tab' })
		})
		expect(document.activeElement).toBe(amountInput)

		await act(() => {
			fireEvent.keyDown(amountInput, { key: 'Tab' })
		})
		expect(document.activeElement).toBe(confirmButton)

		await act(() => {
			fireEvent.keyDown(confirmButton, { key: 'Tab' })
		})
		expect(document.activeElement).toBe(closeButton)

		render(null, container)
		container.remove()
	})

	test('closes on Escape and closes when the backdrop is clicked', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(<DismissibleOperationModalHarness />, container)
		})

		const dialog = within(container).getByRole('dialog', { name: 'Edit amount' })
		await act(() => {
			fireEvent.keyDown(dialog, { key: 'Escape' })
		})
		expect(within(container).queryByRole('dialog', { name: 'Edit amount' })).toBeNull()
		render(null, container)

		await act(() => {
			render(<DismissibleOperationModalHarness />, container)
		})

		const backdrop = container.querySelector('.modal-backdrop') as HTMLDivElement
		if (backdrop === null) throw new Error('Modal backdrop should be visible')
		await act(() => {
			fireEvent.click(backdrop)
		})
		expect(within(container).queryByRole('dialog', { name: 'Edit amount' })).toBeNull()

		render(null, container)
		container.remove()
	})

	test('does nothing for event handling when closed and restores focus with cleanup', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)
		let setOpen: ((open: boolean) => void) | undefined

		await act(() => {
			render(
				<OperationModal isOpen={false} onClose={() => undefined} title='Closed'>
					<p>Nothing</p>
				</OperationModal>,
				container,
			)
		})

		expect(container.querySelector('[role="dialog"]')).toBeNull()

		await act(() => {
			render(<FocusRestoreModalHarness onOpenSetter={value => (setOpen = value)} />, container)
		})
		const focusTarget = document.getElementById('operation-modal-focus-target') as HTMLButtonElement
		focusTarget.focus()
		await act(() => {
			if (setOpen === undefined) throw new Error('Modal open setter missing')
			setOpen(true)
		})
		const closeButton = container.querySelector('.modal-close-button') as HTMLButtonElement
		expect(document.activeElement).toBe(closeButton)

		await act(() => {
			fireEvent.keyDown(closeButton, { key: 'Tab' })
		})
		const amountInput = within(container).getByLabelText('Amount') as HTMLInputElement
		expect(document.activeElement).toBe(amountInput)

		await act(() => {
			fireEvent.keyDown(amountInput, { key: 'Tab' })
		})
		const confirmButton = within(container).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
		expect(document.activeElement).toBe(confirmButton)

		await act(() => {
			const backdrop = container.querySelector('.modal-backdrop') as HTMLDivElement
			if (backdrop === null) throw new Error('Modal backdrop should be visible')
			fireEvent.keyDown(backdrop, { key: 'Escape' })
		})
		expect(document.activeElement).toBe(focusTarget)

		render(null, container)
		container.remove()
	})

	test('returns focus to the first control when focus leaves and handles reverse tab navigation', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

		const documentFocusSentinel = document.createElement('button')
		documentFocusSentinel.type = 'button'
		documentFocusSentinel.textContent = 'Sentinel'
		document.body.appendChild(documentFocusSentinel)

		await act(() => {
			render(
				<OperationModal isOpen onClose={() => undefined} title='Shift-tab modal'>
					<button type='button'>First</button>
					<button type='button'>Second</button>
				</OperationModal>,
				container,
			)
		})

		const closeButton = container.querySelector('.modal-close-button')
		if (closeButton === null) {
			throw new Error('Modal close button should be visible')
		}

		documentFocusSentinel.focus()
		await act(() => {
			fireEvent.keyDown(document, { key: 'Tab' })
		})
		expect(document.activeElement).toBe(closeButton)

		const firstFocusable = container.querySelector('.operation-modal-body button') as HTMLButtonElement
		await act(() => {
			firstFocusable.focus()
			fireEvent.keyDown(firstFocusable, { key: 'Tab', shiftKey: true })
		})
		expect(document.activeElement).toBe(closeButton)

		await act(() => {
			render(null, container)
		})
		document.body.removeChild(documentFocusSentinel)
		container.remove()
	})

	test('restores focus to the first control when activeElement is a non-HTMLElement', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

		const originalHTMLElement = (globalThis as { HTMLElement: unknown }).HTMLElement

		await act(() => {
			render(
				<OperationModal isOpen onClose={() => undefined} title='Non-element active'>
					<button type='button'>Only one</button>
				</OperationModal>,
				container,
			)
		})

		const closeButton = container.querySelector('.modal-close-button') as HTMLButtonElement
		expect(closeButton).not.toBeNull()

		try {
			;(globalThis as { HTMLElement: unknown }).HTMLElement = class {}
			await act(() => {
				fireEvent.keyDown(document, { key: 'Tab' })
			})
			expect(document.activeElement).toBe(closeButton)
		} finally {
			;(globalThis as { HTMLElement: unknown }).HTMLElement = originalHTMLElement
		}

		await act(() => {
			render(null, container)
		})
		container.remove()
	})
})
