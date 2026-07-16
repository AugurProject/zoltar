/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { OperationModal } from '../components/OperationModal.js'
import { AddressValue } from '../components/AddressValue.js'
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

function StackedDismissibleOperationModalHarness() {
	const [isFirstOpen, setIsFirstOpen] = useState(true)
	const [isSecondOpen, setIsSecondOpen] = useState(true)
	return (
		<>
			{isFirstOpen ? (
				<OperationModal
					isOpen
					onClose={() => {
						setIsFirstOpen(false)
					}}
					title='First action'
				>
					<button type='button'>Confirm first</button>
				</OperationModal>
			) : undefined}
			{isSecondOpen ? (
				<OperationModal
					isOpen
					onClose={() => {
						setIsSecondOpen(false)
					}}
					title='Second action'
				>
					<button type='button'>Confirm second</button>
					<button type='button'>Cancel second</button>
				</OperationModal>
			) : undefined}
		</>
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

	test('keeps transaction object identity at the top of the confirmation dialog', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)
		const poolAddress = '0x6E2940600Ac1a17F51A1F82429aDF75f2df6Dab6'
		const vaultAddress = '0x00000000000000000000000000000000000000A1'

		await act(() => {
			render(
				<OperationModal
					context={[
						{ label: 'Question', value: 'Will this resolve?' },
						{ label: 'Security pool', value: <AddressValue address={poolAddress} /> },
						{ label: 'Universe', value: 'Genesis (0)' },
						{ label: 'Vault', value: <AddressValue address={vaultAddress} /> },
					]}
					isOpen
					onClose={() => undefined}
					title='Review Action'
				>
					<button type='button'>Confirm</button>
				</OperationModal>,
				container,
			)
		})

		const dialog = within(container).getByRole('dialog', { name: 'Review Action' })
		expect(within(dialog).getByText('Confirm transaction context')).not.toBeNull()
		expect(within(dialog).getByText('Will this resolve?')).not.toBeNull()
		expect(within(dialog).getByText('Genesis (0)')).not.toBeNull()
		expect(within(dialog).getByRole('button', { name: `Copy address ${poolAddress}` }).textContent).toBe(poolAddress)
		expect(within(dialog).getByRole('button', { name: `Copy address ${vaultAddress}` }).textContent).toBe(vaultAddress)

		render(null, container)
		container.remove()
	})

	test('hides sibling page content from the accessibility tree while open and restores it on close', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(
				<>
					<section aria-hidden='false' data-testid='page-content'>
						<h2>Page content</h2>
						<button type='button'>Background Action</button>
					</section>
					<OperationModal isOpen onClose={() => undefined} title='Review Action'>
						<button type='button'>Confirm</button>
					</OperationModal>
				</>,
				container,
			)
		})

		const pageContent = container.querySelector('[data-testid="page-content"]')
		if (!(pageContent instanceof HTMLElement)) throw new Error('Expected page content')
		expect(pageContent.getAttribute('aria-hidden')).toBe('true')
		expect(pageContent.hasAttribute('inert')).toBe(true)
		expect(within(container).getByRole('dialog', { name: 'Review Action' })).not.toBeNull()

		await act(() => {
			render(
				<>
					<section aria-hidden='false' data-testid='page-content'>
						<h2>Page content</h2>
						<button type='button'>Background Action</button>
					</section>
					<OperationModal isOpen={false} onClose={() => undefined} title='Review Action'>
						<button type='button'>Confirm</button>
					</OperationModal>
				</>,
				container,
			)
		})

		const restoredPageContent = container.querySelector('[data-testid="page-content"]')
		if (!(restoredPageContent instanceof HTMLElement)) throw new Error('Expected restored page content')
		expect(restoredPageContent.getAttribute('aria-hidden')).toBe('false')
		expect(restoredPageContent.hasAttribute('inert')).toBe(false)

		render(null, container)
		container.remove()
	})

	test('hides app shell content outside the local modal parent while open', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

		const renderShell = async (isOpen: boolean) => {
			await act(() => {
				render(
					<div data-testid='app-root'>
						<header aria-hidden='false' data-testid='app-header'>
							<button type='button'>Global Navigation</button>
						</header>
						<main data-testid='app-main'>
							<aside aria-hidden='false' data-testid='route-sidebar'>
								<button type='button'>Route Action</button>
							</aside>
							<section data-testid='route-content'>
								<div aria-hidden='false' data-testid='local-content'>
									<button type='button'>Local Action</button>
								</div>
								<OperationModal isOpen={isOpen} onClose={() => undefined} title='Review Action'>
									<button type='button'>Confirm</button>
								</OperationModal>
							</section>
						</main>
					</div>,
					container,
				)
			})
		}

		await renderShell(true)

		for (const testId of ['app-header', 'route-sidebar', 'local-content']) {
			const element = container.querySelector(`[data-testid="${testId}"]`)
			if (!(element instanceof HTMLElement)) throw new Error(`Expected ${testId}`)
			expect(element.getAttribute('aria-hidden')).toBe('true')
			expect(element.hasAttribute('inert')).toBe(true)
		}

		await renderShell(false)

		for (const testId of ['app-header', 'route-sidebar', 'local-content']) {
			const element = container.querySelector(`[data-testid="${testId}"]`)
			if (!(element instanceof HTMLElement)) throw new Error(`Expected restored ${testId}`)
			expect(element.getAttribute('aria-hidden')).toBe('false')
			expect(element.hasAttribute('inert')).toBe(false)
		}

		render(null, container)
		container.remove()
	})

	test('keeps sibling page content hidden until every stacked modal closes', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(
				<>
					<section aria-hidden='false' data-testid='page-content'>
						<h2>Page content</h2>
						<button type='button'>Background Action</button>
					</section>
					<OperationModal isOpen onClose={() => undefined} title='First action'>
						<button type='button'>Confirm first</button>
					</OperationModal>
					<OperationModal isOpen onClose={() => undefined} title='Second action'>
						<button type='button'>Confirm second</button>
					</OperationModal>
				</>,
				container,
			)
		})

		const pageContent = container.querySelector('[data-testid="page-content"]')
		if (!(pageContent instanceof HTMLElement)) throw new Error('Expected page content')
		expect(pageContent.getAttribute('aria-hidden')).toBe('true')
		expect(pageContent.hasAttribute('inert')).toBe(true)
		const stackedBackdrops = container.querySelectorAll('.modal-backdrop')
		const firstBackdrop = stackedBackdrops[0]
		if (!(firstBackdrop instanceof HTMLElement)) throw new Error('Expected first modal backdrop')
		expect(firstBackdrop.getAttribute('aria-hidden')).toBe('true')
		expect(firstBackdrop.hasAttribute('inert')).toBe(true)

		await act(() => {
			render(
				<>
					<section aria-hidden='false' data-testid='page-content'>
						<h2>Page content</h2>
						<button type='button'>Background Action</button>
					</section>
					<OperationModal isOpen={false} onClose={() => undefined} title='First action'>
						<button type='button'>Confirm first</button>
					</OperationModal>
					<OperationModal isOpen onClose={() => undefined} title='Second action'>
						<button type='button'>Confirm second</button>
					</OperationModal>
				</>,
				container,
			)
		})

		const hiddenPageContent = container.querySelector('[data-testid="page-content"]')
		if (!(hiddenPageContent instanceof HTMLElement)) throw new Error('Expected hidden page content')
		expect(hiddenPageContent.getAttribute('aria-hidden')).toBe('true')
		expect(hiddenPageContent.hasAttribute('inert')).toBe(true)
		expect(within(container).getByRole('dialog', { name: 'Second action' })).not.toBeNull()
		const restoredFirstBackdrop = container.querySelector('.modal-backdrop')
		if (!(restoredFirstBackdrop instanceof HTMLElement)) throw new Error('Expected restored first modal backdrop')
		expect(restoredFirstBackdrop.getAttribute('aria-hidden')).toBe(null)
		expect(restoredFirstBackdrop.hasAttribute('inert')).toBe(false)

		await act(() => {
			render(
				<>
					<section aria-hidden='false' data-testid='page-content'>
						<h2>Page content</h2>
						<button type='button'>Background Action</button>
					</section>
					<OperationModal isOpen={false} onClose={() => undefined} title='First action'>
						<button type='button'>Confirm first</button>
					</OperationModal>
					<OperationModal isOpen={false} onClose={() => undefined} title='Second action'>
						<button type='button'>Confirm second</button>
					</OperationModal>
				</>,
				container,
			)
		})

		const restoredPageContent = container.querySelector('[data-testid="page-content"]')
		if (!(restoredPageContent instanceof HTMLElement)) throw new Error('Expected restored page content')
		expect(restoredPageContent.getAttribute('aria-hidden')).toBe('false')
		expect(restoredPageContent.hasAttribute('inert')).toBe(false)

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

	test('lets only the top stacked modal handle Escape', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(<StackedDismissibleOperationModalHarness />, container)
		})

		expect(within(container).getByRole('dialog', { name: 'First action' })).not.toBeNull()
		expect(within(container).getByRole('dialog', { name: 'Second action' })).not.toBeNull()

		await act(() => {
			fireEvent.keyDown(document, { key: 'Escape' })
		})

		expect(within(container).getByRole('dialog', { name: 'First action' })).not.toBeNull()
		expect(within(container).queryByRole('dialog', { name: 'Second action' })).toBeNull()

		await act(() => {
			fireEvent.keyDown(document, { key: 'Escape' })
		})
		expect(within(container).queryByRole('dialog', { name: 'First action' })).toBeNull()

		render(null, container)
		container.remove()
	})

	test('cycles Tab through the top stacked modal controls', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(<StackedDismissibleOperationModalHarness />, container)
		})

		const firstDialog = within(container).getByRole('dialog', { name: 'First action' })
		const secondDialog = within(container).getByRole('dialog', { name: 'Second action' })
		const firstCloseButton = within(firstDialog).getByRole('button', { name: 'Close' })
		const secondCloseButton = within(secondDialog).getByRole('button', { name: 'Close' })
		const secondConfirmButton = within(secondDialog).getByRole('button', { name: 'Confirm second' })

		expect(document.activeElement).toBe(secondCloseButton)

		await act(() => {
			fireEvent.keyDown(document, { key: 'Tab' })
		})
		expect(document.activeElement).toBe(secondConfirmButton)
		expect(document.activeElement).not.toBe(firstCloseButton)

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

	test('wraps focus forward and backward inside the modal', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

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

		const firstFocusable = container.querySelector('.operation-modal-body button') as HTMLButtonElement
		await act(() => {
			fireEvent.keyDown(document, { key: 'Tab' })
		})
		expect(document.activeElement === firstFocusable).toBe(true)

		await act(() => {
			firstFocusable.focus()
			fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
		})
		expect(document.activeElement === closeButton).toBe(true)

		await act(() => {
			render(null, container)
		})
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
