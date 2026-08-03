/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { OperationModal } from '../components/OperationModal.js'
import { AddressValue } from '../components/AddressValue.js'
import { GlobalTransactionPresentationProvider } from '../components/GlobalTransactionPresentationContext.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { createInitialTransactionTrayState, markTransactionFailed, markTransactionFinished, markTransactionPresented, markTransactionRequested, markTransactionSubmitted } from '../lib/transactionTray.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import type { GlobalTransactionPresentation, TransactionIntent } from '../types/components.js'

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

function BusyOperationModalHarness() {
	return (
		<OperationModal closeDisabled isOpen onClose={() => undefined} title='Busy action'>
			<button type='button'>Available action</button>
		</OperationModal>
	)
}

function DisclosureOperationModalHarness() {
	return (
		<OperationModal isOpen onClose={() => undefined} title='Review transaction'>
			<div hidden>
				<button type='button'>Hidden action</button>
			</div>
			<div inert>
				<button type='button'>Inert action</button>
			</div>
			<a href='#skipped-action' tabIndex={-1}>
				Skipped action
			</a>
			<details>
				<summary>Technical details</summary>
				<p>Call data</p>
			</details>
		</OperationModal>
	)
}

function CompletingOperationModalHarness() {
	const [isOpen, setIsOpen] = useState(true)
	const [completionKey, setCompletionKey] = useState<string | undefined>()
	const [transaction, setTransaction] = useState<GlobalTransactionPresentation | undefined>()
	const transactionHash = '0x1234000000000000000000000000000000000000000000000000000000000000' as const

	return (
		<GlobalTransactionPresentationProvider transaction={transaction}>
			<OperationModal closeOnSuccessKey={completionKey} isOpen={isOpen} onClose={() => setIsOpen(false)} title='Deposit REP'>
				<button
					type='button'
					onClick={() => {
						setCompletionKey(transactionHash)
						setTransaction({
							dismissKey: transactionHash,
							hash: transactionHash,
							operationKey: 'deposit-request',
							title: 'Deposit confirmed',
							tone: 'success',
						})
					}}
				>
					Complete transaction
				</button>
			</OperationModal>
		</GlobalTransactionPresentationProvider>
	)
}

function StaleCompletionOperationModalHarness() {
	const [isOpen, setIsOpen] = useState(true)
	const [completionState, setCompletionState] = useState<'matching' | 'stale' | 'unrelated'>('stale')
	const staleHash = '0x1111000000000000000000000000000000000000000000000000000000000000' as const
	const unrelatedHash = '0x2222000000000000000000000000000000000000000000000000000000000000' as const
	const matchingHash = '0x3333000000000000000000000000000000000000000000000000000000000000' as const
	let closeOnSuccessKey: string | undefined
	if (completionState === 'stale') closeOnSuccessKey = staleHash
	if (completionState === 'matching') closeOnSuccessKey = matchingHash
	let transaction: GlobalTransactionPresentation = { dismissKey: staleHash, hash: staleHash, operationKey: 'stale-request', title: 'Stale success', tone: 'success' }
	if (completionState === 'unrelated') transaction = { dismissKey: unrelatedHash, hash: unrelatedHash, operationKey: 'unrelated-request', title: 'Unrelated success', tone: 'success' }
	if (completionState === 'matching') transaction = { dismissKey: matchingHash, hash: matchingHash, operationKey: 'matching-request', title: 'Matching success', tone: 'success' }

	return (
		<GlobalTransactionPresentationProvider transaction={transaction}>
			<OperationModal closeOnSuccessKey={closeOnSuccessKey} isOpen={isOpen} onClose={() => setIsOpen(false)} title='Settle Report'>
				<button type='button' onClick={() => setCompletionState('unrelated')}>
					Observe unrelated success
				</button>
				<button type='button' onClick={() => setCompletionState('matching')}>
					Complete matching transaction
				</button>
			</OperationModal>
		</GlobalTransactionPresentationProvider>
	)
}

function TransactionFeedbackOperationModalHarness() {
	const [isOpen, setIsOpen] = useState(true)
	const [transaction, setTransaction] = useState<GlobalTransactionPresentation>({
		dismissKey: 'transaction-request-1',
		title: 'Disputing report',
		tone: 'pending',
	})

	return (
		<GlobalTransactionPresentationProvider transaction={transaction}>
			<OperationModal
				context={[
					{ identityKey: 'security-pool', label: 'Security Pool Address', value: '0xpool' },
					{ identityKey: 'outcome', label: 'Outcome', value: 'Yes' },
				]}
				isOpen={isOpen}
				onClose={() => setIsOpen(false)}
				title='Migrate Shares'
			>
				<button
					type='button'
					onClick={() =>
						setTransaction({
							detail: 'Submitting the prerequisite approval.',
							dismissKey: 'transaction-request-2',
							rows: [
								{ identityKey: 'security-pool', label: 'Pool', value: '0xpool' },
								{ identityKey: 'outcome', label: 'Share Outcome', value: 'Yes' },
								{ label: 'Approval Amount', value: '2 REP' },
							],
							title: 'Approve REP',
							tone: 'preparing',
						})
					}
				>
					Start prerequisite
				</button>
				<button
					type='button'
					onClick={() =>
						setTransaction({
							detail: 'Approval confirmed. Continue with the dispute.',
							dismissKey: 'transaction-request-2',
							rows: [
								{ identityKey: 'security-pool', label: 'Pool', value: '0xpool' },
								{ identityKey: 'outcome', label: 'Share Outcome', value: 'Yes' },
								{ label: 'Approval Amount', value: '2 REP' },
							],
							title: 'Approval confirmed',
							tone: 'success',
						})
					}
				>
					Complete prerequisite
				</button>
				<button
					type='button'
					onClick={() =>
						setTransaction({
							detail: 'The share migration transaction failed.',
							dismissKey: 'transaction-request-2',
							title: 'Share migration failed',
							tone: 'error',
						})
					}
				>
					Fail transaction
				</button>
			</OperationModal>
		</GlobalTransactionPresentationProvider>
	)
}

const existingTransactionHash = '0x1111000000000000000000000000000000000000000000000000000000000000'
const newTransactionHash = '0x2222000000000000000000000000000000000000000000000000000000000000'
const existingTransactionIntent: TransactionIntent = {
	action: 'existingAction',
	requiresWalletConfirmation: false,
	source: 'test',
	submittedTitle: 'Existing transaction',
}
const newTransactionIntent: TransactionIntent = {
	action: 'newAction',
	requiresWalletConfirmation: false,
	source: 'test',
	submittedTitle: 'New transaction',
}

function ExistingTransactionLifecycleOperationModalHarness() {
	const [transactionState, setTransactionState] = useState(() => markTransactionRequested(createInitialTransactionTrayState(), existingTransactionIntent))

	return (
		<GlobalTransactionPresentationProvider transaction={transactionState.active}>
			<OperationModal isOpen onClose={() => undefined} title='Start another operation'>
				<button type='button' onClick={() => setTransactionState(state => markTransactionSubmitted(state, existingTransactionHash))}>
					Submit existing transaction
				</button>
				<button type='button' onClick={() => setTransactionState(state => markTransactionFailed(state, 'The existing transaction failed.'))}>
					Fail existing transaction
				</button>
				<button
					type='button'
					onClick={() =>
						setTransactionState(state =>
							markTransactionPresented(state, {
								dismissKey: existingTransactionHash,
								hash: existingTransactionHash,
								title: 'Existing transaction confirmed',
								tone: 'success',
							}),
						)
					}
				>
					Complete existing transaction
				</button>
				<button type='button' onClick={() => setTransactionState(state => markTransactionRequested(markTransactionFinished(state), newTransactionIntent))}>
					Start new transaction
				</button>
				<button type='button' onClick={() => setTransactionState(state => markTransactionSubmitted(state, newTransactionHash))}>
					Submit new transaction
				</button>
				<button type='button' onClick={() => setTransactionState(state => markTransactionFailed(state, 'The new transaction failed.'))}>
					Fail new transaction
				</button>
				<button
					type='button'
					onClick={() =>
						setTransactionState(state =>
							markTransactionPresented(state, {
								dismissKey: newTransactionHash,
								hash: newTransactionHash,
								title: 'New transaction confirmed',
								tone: 'success',
							}),
						)
					}
				>
					Complete new transaction
				</button>
			</OperationModal>
		</GlobalTransactionPresentationProvider>
	)
}

function ReopenedTransactionLifecycleOperationModalHarness() {
	const [completionKey, setCompletionKey] = useState<string | undefined>()
	const [isOpen, setIsOpen] = useState(true)
	const [transactionState, setTransactionState] = useState(createInitialTransactionTrayState)

	const startTransaction = (intent: TransactionIntent, hash: typeof existingTransactionHash | typeof newTransactionHash) => {
		setTransactionState(state => markTransactionSubmitted(markTransactionRequested(state, intent), hash))
	}
	const completeTransaction = (hash: typeof existingTransactionHash | typeof newTransactionHash, title: string) => {
		setCompletionKey(hash)
		setTransactionState(state =>
			markTransactionPresented(markTransactionFinished(state), {
				dismissKey: hash,
				hash,
				title,
				tone: 'success',
			}),
		)
	}

	return (
		<GlobalTransactionPresentationProvider transaction={transactionState.active}>
			<button type='button' onClick={() => setIsOpen(true)}>
				Reopen operation
			</button>
			<button type='button' onClick={() => startTransaction(existingTransactionIntent, existingTransactionHash)}>
				Start first transaction
			</button>
			<button type='button' onClick={() => completeTransaction(existingTransactionHash, 'First transaction confirmed')}>
				Complete first transaction
			</button>
			<button type='button' onClick={() => startTransaction(newTransactionIntent, newTransactionHash)}>
				Start second transaction
			</button>
			<button type='button' onClick={() => completeTransaction(newTransactionHash, 'Second transaction confirmed')}>
				Complete second transaction
			</button>
			<OperationModal closeOnSuccessKey={completionKey} isOpen={isOpen} onClose={() => setIsOpen(false)} title='Submit operation'>
				<p>Review this operation.</p>
			</OperationModal>
		</GlobalTransactionPresentationProvider>
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

	test('closes an operation dialog when its submitted transaction succeeds', async () => {
		const renderedComponent = await renderIntoDocument(<CompletingOperationModalHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('dialog', { name: 'Deposit REP' })).not.toBeNull()
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Complete transaction' }))
		})

		expect(documentQueries.queryByRole('dialog', { name: 'Deposit REP' })).toBeNull()
	})

	test('ignores stale and unrelated success state before closing for a new matching success', async () => {
		const renderedComponent = await renderIntoDocument(<StaleCompletionOperationModalHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('dialog', { name: 'Settle Report' })).not.toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Observe unrelated success' }))
		})
		expect(documentQueries.getByRole('dialog', { name: 'Settle Report' })).not.toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Complete matching transaction' }))
		})
		expect(documentQueries.queryByRole('dialog', { name: 'Settle Report' })).toBeNull()
	})

	test('surfaces transaction feedback, filters semantic trading context aliases, and preserves multi-step context', async () => {
		const renderedComponent = await renderIntoDocument(<TransactionFeedbackOperationModalHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const dialog = documentQueries.getByRole('dialog', { name: 'Migrate Shares' })
		expect(within(dialog).queryByRole('status')).toBeNull()
		expect(within(dialog).queryByText('Approval confirmed')).toBeNull()
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Start prerequisite' }))
		})

		expect(documentQueries.getByRole('dialog', { name: 'Migrate Shares' })).not.toBeNull()
		expect(within(dialog).getByRole('status').textContent).toContain('Approve REP')
		expect(within(dialog).getByRole('status').textContent).not.toContain('Pool')
		expect(within(dialog).getByRole('status').textContent).not.toContain('Share Outcome')
		expect(within(dialog).getByRole('status').textContent).toContain('Approval Amount')
		expect(dialog.textContent?.match(/Security Pool Address/g)).toHaveLength(1)
		expect(dialog.textContent?.match(/Outcome/g)).toHaveLength(1)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Complete prerequisite' }))
		})

		expect(documentQueries.getByRole('dialog', { name: 'Migrate Shares' })).not.toBeNull()
		expect(within(dialog).getByRole('status').textContent).toContain('Approval confirmed')
		expect(within(dialog).getByRole('status').textContent).not.toContain('Pool')
		expect(within(dialog).getByRole('status').textContent).not.toContain('Share Outcome')
		expect(within(dialog).getByRole('status').textContent).toContain('Approval Amount')
		expect(dialog.textContent?.match(/Security Pool Address/g)).toHaveLength(1)
		expect(dialog.textContent?.match(/Outcome/g)).toHaveLength(1)
		expect(within(dialog).getByText('Fail transaction')).not.toBeNull()
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Fail transaction' }))
		})

		expect(documentQueries.getByRole('dialog', { name: 'Migrate Shares' })).not.toBeNull()
		expect(within(dialog).getByRole('alert').textContent).toContain('The share migration transaction failed.')
	})

	test('keeps a transaction that predates the modal hidden across its lifecycle and surfaces a later operation', async () => {
		const renderedComponent = await renderIntoDocument(<ExistingTransactionLifecycleOperationModalHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const dialog = documentQueries.getByRole('dialog', { name: 'Start another operation' })
		expect(within(dialog).queryByRole('status')).toBeNull()

		await act(() => {
			fireEvent.click(within(dialog).getByRole('button', { name: 'Submit existing transaction' }))
		})
		expect(within(dialog).queryByRole('status')).toBeNull()

		await act(() => {
			fireEvent.click(within(dialog).getByRole('button', { name: 'Fail existing transaction' }))
		})
		expect(within(dialog).queryByRole('status')).toBeNull()

		await act(() => {
			fireEvent.click(within(dialog).getByRole('button', { name: 'Complete existing transaction' }))
		})
		expect(within(dialog).queryByRole('status')).toBeNull()

		await act(() => {
			fireEvent.click(within(dialog).getByRole('button', { name: 'Start new transaction' }))
		})
		expect(within(dialog).getByRole('status').textContent).toContain('New transaction')

		await act(() => {
			fireEvent.click(within(dialog).getByRole('button', { name: 'Submit new transaction' }))
		})
		expect(within(dialog).getByRole('status').textContent).toContain('New transaction')
		expect(within(dialog).getByRole('status').textContent).toContain('Pending')

		await act(() => {
			fireEvent.click(within(dialog).getByRole('button', { name: 'Fail new transaction' }))
		})
		expect(within(dialog).getByRole('alert').textContent).toContain('The new transaction failed.')

		await act(() => {
			fireEvent.click(within(dialog).getByRole('button', { name: 'Complete new transaction' }))
		})
		expect(within(dialog).getByRole('status').textContent).toContain('New transaction confirmed')
	})

	test('does not close a reopened modal when a transaction from its previous instance succeeds', async () => {
		const renderedComponent = await renderIntoDocument(<ReopenedTransactionLifecycleOperationModalHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Start first transaction' }))
		})
		await act(() => {
			fireEvent.click(within(documentQueries.getByRole('dialog', { name: 'Submit operation' })).getByRole('button', { name: 'Close' }))
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Reopen operation' }))
		})
		expect(documentQueries.getByRole('dialog', { name: 'Submit operation' })).not.toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Complete first transaction' }))
		})
		expect(documentQueries.getByRole('dialog', { name: 'Submit operation' })).not.toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Start second transaction' }))
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Complete second transaction' }))
		})
		expect(documentQueries.queryByRole('dialog', { name: 'Submit operation' })).toBeNull()
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
		document.body.style.overflow = 'scroll'

		await act(() => {
			render(<StackedDismissibleOperationModalHarness />, container)
		})

		expect(within(container).getByRole('dialog', { name: 'First action' })).not.toBeNull()
		expect(within(container).getByRole('dialog', { name: 'Second action' })).not.toBeNull()
		expect(document.body.style.overflow).toBe('hidden')

		await act(() => {
			fireEvent.keyDown(document, { key: 'Escape' })
		})

		expect(within(container).getByRole('dialog', { name: 'First action' })).not.toBeNull()
		expect(within(container).queryByRole('dialog', { name: 'Second action' })).toBeNull()
		expect(document.body.style.overflow).toBe('hidden')

		await act(() => {
			fireEvent.keyDown(document, { key: 'Escape' })
		})
		expect(within(container).queryByRole('dialog', { name: 'First action' })).toBeNull()
		expect(document.body.style.overflow).toBe('scroll')

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

	test('includes disclosure summaries in the modal Tab order', async () => {
		const renderedComponent = await renderIntoDocument(<DisclosureOperationModalHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const dialog = within(document.body).getByRole('dialog', { name: 'Review transaction' })
		const closeButton = within(dialog).getByRole('button', { name: 'Close' })
		const summary = within(dialog).getByText('Technical details', { selector: 'summary' })

		expect(document.activeElement).toBe(closeButton)
		await act(() => {
			fireEvent.keyDown(closeButton, { key: 'Tab' })
		})
		expect(document.activeElement).toBe(summary)
		await act(() => {
			fireEvent.keyDown(summary, { key: 'Tab' })
		})
		expect(document.activeElement).toBe(closeButton)
	})

	test('focuses an available control and locks page scrolling when the close button is disabled', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)
		document.body.style.overflow = 'scroll'

		await act(() => {
			render(<BusyOperationModalHarness />, container)
		})

		const availableAction = within(container).getByRole('button', { name: 'Available action' })
		expect(document.activeElement).toBe(availableAction)
		expect(document.body.style.overflow).toBe('hidden')

		await act(() => {
			render(null, container)
		})
		expect(document.body.style.overflow).toBe('scroll')
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
