/// <reference types="bun-types" />

import { expect, test } from 'bun:test'
import { signal } from '@preact/signals'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { GlobalTransactionPresentationProvider } from '../components/GlobalTransactionPresentationContext.js'
import { OperationModal } from '../components/OperationModal.js'
import { TransactionActionGroup } from '../components/TransactionActionButton.js'
import { TransactionStepsModal } from '../components/TransactionStepsModal.js'
import { createTransactionStepController, transactionSteps } from '../transactions/transactionSteps.js'
import type { GlobalTransactionPresentation } from '../types/components.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { fireEvent, within } from './testUtils/queries.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { createDeferred } from './testUtils/deferred.js'
import { isTransactionReviewCancellation } from '../lib/errors.js'

installDomTestLifecycle()

const hash = '0x1111111111111111111111111111111111111111111111111111111111111111'
const step = { title: 'Send withdrawal', description: 'Withdraw REP.', contractAddress: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }

for (const outcome of ['success', 'failure', 'approval', 'cancel', 'multi-step'] as const) {
	test(`keeps the transaction inside the initiating dialog through ${outcome}`, async () => {
		const showsReview = outcome === 'multi-step' || outcome === 'cancel'
		const presentation = signal<GlobalTransactionPresentation | undefined>(undefined)
		const completedHash = signal<string | undefined>(undefined)
		let controller: ReturnType<typeof createTransactionStepController> | undefined
		let review: Promise<bigint | undefined> | undefined
		function Harness() {
			const [open, setOpen] = useState(true)
			return (
				<GlobalTransactionPresentationProvider transaction={presentation.value}>
					<OperationModal confirmSingleStepFromForm isOpen={open} title='Withdraw REP' closeOnSuccessKey={completedHash.value} onClose={() => setOpen(false)}>
						<input aria-label='Amount' defaultValue='42' />
						<button
							type='button'
							onClick={() => {
								presentation.value = { operationKey: 'withdrawal', title: 'Preparing withdrawal', tone: 'preparing' }
								controller = createTransactionStepController()
								controller.setPlan(showsReview ? [{ ...step, title: 'Approve REP' }, step] : [step])
								review = controller.review().catch(() => undefined)
							}}
						>
							Review withdrawal
						</button>
					</OperationModal>
					<TransactionStepsModal contextKey='wallet' />
				</GlobalTransactionPresentationProvider>
			)
		}
		const rendered = await renderIntoDocument(<Harness />)
		try {
			const queries = within(document.body)
			const dialog = queries.getByRole('dialog', { name: 'Withdraw REP' })
			const form = () => dialog.querySelector('.operation-modal-body')
			const steps = () => dialog.querySelector('.operation-modal-steps')
			await act(() => fireEvent.click(queries.getByRole('button', { name: 'Review withdrawal' })))
			expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
			expect(form()?.hasAttribute('inert')).toBe(showsReview)
			expect(steps() !== null).toBe(showsReview)
			if (showsReview) expect(steps()?.contains(document.activeElement)).toBe(true)
			else expect(within(dialog).queryByRole('button', { name: 'Send withdrawal' })).toBeNull()
			expect(queries.getByRole('textbox', { name: 'Amount' }).getAttribute('value')).toBe('42')
			if (controller === undefined) throw new Error('Missing transaction controller')
			if (outcome === 'cancel') {
				await act(() => fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })))
				await review
				expect(queries.getByRole('dialog')).toBe(dialog)
				expect(steps()).toBeNull()
				expect(form()?.hasAttribute('inert')).toBe(false)
				expect(transactionSteps.value).toBeUndefined()
				return
			}
			if (showsReview) await act(() => fireEvent.click(within(dialog).getByRole('button', { name: 'Approve REP' })))
			await review
			const firstHash = outcome === 'multi-step' ? '0x2222222222222222222222222222222222222222222222222222222222222222' : hash
			await act(() => {
				controller?.submitted(firstHash)
				presentation.value = { operationKey: 'withdrawal', title: 'Withdrawal pending', tone: 'pending', hash: firstHash }
			})
			expect(steps() !== null).toBe(showsReview)
			expect(queries.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(true)
			await act(() => fireEvent.keyDown(dialog, { key: 'Escape' }))
			expect(queries.getByRole('dialog')).toBe(dialog)
			if (outcome === 'multi-step') {
				await act(() => {
					controller?.receipt(firstHash, 'success')
					review = controller?.review(1).catch(() => undefined)
				})
				expect(steps()).not.toBeNull()
				for (const unrelatedHash of [undefined, '0x33']) {
					await act(() => {
						presentation.value = { tone: 'success', title: 'Unrelated transaction confirmed', ...(unrelatedHash === undefined ? {} : { hash: unrelatedHash }), operationKey: 'unrelated' }
					})
					expect(transactionSteps.value?.steps[1]?.phase).toBe('review')
				}
				expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
				await act(() => fireEvent.click(queries.getByRole('button', { name: 'Send withdrawal' })))
				await review
				await act(() => controller?.submitted(hash))
			}
			await act(() => {
				controller?.receipt(hash, outcome === 'failure' ? 'reverted' : 'success')
				if (outcome === 'success' || outcome === 'multi-step') completedHash.value = hash
				presentation.value = { operationKey: 'withdrawal', title: outcome === 'failure' ? 'Withdrawal failed' : 'Transaction confirmed', tone: outcome === 'failure' ? 'error' : 'success', detail: outcome === 'failure' ? 'Transaction reverted.' : undefined, hash }
			})
			if (outcome === 'success' || outcome === 'multi-step') {
				expect(within(dialog).getByText('Transaction confirmed')).not.toBeNull()
				await act(() => fireEvent.click(within(dialog).getByRole('button', { name: 'Done' })))
				expect(queries.queryByRole('dialog')).toBeNull()
				expect(transactionSteps.value).toBeUndefined()
			} else {
				// Both outcomes return to the form on their own and explain themselves through the notice below it.
				expect(dialog.querySelector('.operation-modal-transaction-notice')?.textContent).toContain(outcome === 'failure' ? 'Transaction reverted' : 'Transaction confirmed')
				expect(queries.queryByRole('button', { name: 'Back' })).toBeNull()
				expect(queries.getByRole('dialog')).toBe(dialog)
				expect(steps()).toBeNull()
				expect(form()?.hasAttribute('inert')).toBe(false)
				expect(queries.getByRole('textbox', { name: 'Amount' }).getAttribute('value')).toBe('42')
				expect(transactionSteps.value).toBeUndefined()
			}
		} finally {
			await rendered.cleanup()
			transactionSteps.value?.cancel()
		}
	})
}

test('sends an approval-only workflow from the form control without a separate review', async () => {
	const presentation = signal<GlobalTransactionPresentation | undefined>(undefined)
	let controller: ReturnType<typeof createTransactionStepController> | undefined
	let review: Promise<bigint | undefined> | undefined
	function Harness() {
		return (
			<GlobalTransactionPresentationProvider transaction={presentation.value}>
				<OperationModal isOpen title='Deposit REP' onClose={() => undefined}>
					<input aria-label='Amount' defaultValue='1' />
					<button
						type='button'
						onClick={() => {
							presentation.value = { operationKey: 'approval', title: 'Preparing approval', tone: 'preparing' }
							controller = createTransactionStepController()
							controller.setPlan([{ ...step, title: 'Approve REP', spender: '0x00000000000000000000000000000000000000a1', amount: '1 REP' }])
							review = controller.review()
						}}
					>
						Approve REP
					</button>
				</OperationModal>
				<TransactionStepsModal contextKey='wallet' />
			</GlobalTransactionPresentationProvider>
		)
	}
	const rendered = await renderIntoDocument(<Harness />)
	try {
		const queries = within(document.body)
		const dialog = queries.getByRole('dialog', { name: 'Deposit REP' })
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Approve REP' })))
		expect(await review).toBeUndefined()
		expect(transactionSteps.value?.steps[0]?.phase).toBe('pending')
		expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
		expect(dialog.querySelector('.operation-modal-steps')).toBeNull()
		expect(dialog.querySelector('.operation-modal-body')?.hasAttribute('inert')).toBe(false)
		expect(dialog.querySelector('.transaction-plan-action')).toBeNull()
		expect(within(dialog).getAllByRole('button', { name: 'Approve REP' })).toHaveLength(1)

		// A rejected approval surfaces through the dialog notice and leaves the form ready for another attempt.
		const failedWorkflow = transactionSteps.value
		await act(() => {
			controller?.failed('Action canceled in wallet.')
			presentation.value = { operationKey: 'approval', title: 'Approval failed', tone: 'error', detail: 'Action canceled in wallet.' }
		})
		expect(dialog.querySelector('.operation-modal-steps')).toBeNull()
		expect(dialog.querySelector('.operation-modal-body')?.hasAttribute('inert')).toBe(false)
		expect(dialog.querySelector('.operation-modal-transaction-notice')?.textContent).toContain('Action canceled in wallet.')
		expect(queries.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(false)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Approve REP' })))
		expect(await review).toBeUndefined()
		expect(transactionSteps.value).not.toBe(failedWorkflow)
		expect(transactionSteps.value?.steps[0]?.phase).toBe('pending')
	} finally {
		await rendered.cleanup()
		transactionSteps.value?.cancel()
	}
})

test("renders the review actions in the form's own action row and isolates the rest of the form", async () => {
	const presentation = signal<GlobalTransactionPresentation | undefined>(undefined)
	let controller: ReturnType<typeof createTransactionStepController> | undefined
	let review: Promise<bigint | undefined> | undefined
	function Harness() {
		return (
			<GlobalTransactionPresentationProvider transaction={presentation.value}>
				<OperationModal isOpen title='Withdraw REP' onClose={() => undefined}>
					<input aria-label='Amount' defaultValue='42' />
					<TransactionActionGroup message={undefined}>
						<button
							type='button'
							onClick={() => {
								presentation.value = { operationKey: 'withdrawal', title: 'Preparing withdrawal', tone: 'preparing' }
								controller = createTransactionStepController()
								controller.setPlan([step, { ...step, title: 'Finish withdrawal' }])
								review = controller.review().catch(() => undefined)
							}}
						>
							Withdraw
						</button>
						<button type='button'>Cancel</button>
					</TransactionActionGroup>
				</OperationModal>
				<TransactionStepsModal contextKey='wallet' />
			</GlobalTransactionPresentationProvider>
		)
	}
	const rendered = await renderIntoDocument(<Harness />)
	try {
		const queries = within(document.body)
		const dialog = queries.getByRole('dialog', { name: 'Withdraw REP' })
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Withdraw' })))
		const slot = dialog.querySelector('[data-review-actions-slot]')
		if (!(slot instanceof HTMLElement)) throw new Error('Expected the form action row to host the review')
		// One action row: the form's own buttons are replaced by the review's confirm and cancel.
		expect(within(slot).getByRole('button', { name: 'Send withdrawal' })).not.toBeNull()
		expect(within(slot).getByRole('button', { name: 'Cancel' })).not.toBeNull()
		expect(queries.queryByRole('button', { name: 'Withdraw' })).toBeNull()
		expect(within(slot).getAllByRole('button', { name: 'Cancel' })).toHaveLength(1)
		expect(dialog.querySelector('.operation-modal-steps .transaction-step-actions')).toBeNull()
		expect(slot.hasAttribute('inert')).toBe(false)
		expect(dialog.querySelector('.operation-modal-body')?.hasAttribute('inert')).toBe(false)
		expect(queries.getByRole('textbox', { name: 'Amount' }).closest('[inert]')).not.toBeNull()
		await act(() => fireEvent.click(within(slot).getByRole('button', { name: 'Send withdrawal' })))
		await review
		expect(transactionSteps.value?.steps[0]?.phase).toBe('pending')
		await act(() => {
			controller?.submitted(hash)
			presentation.value = { operationKey: 'withdrawal', title: 'Transaction confirmed', tone: 'success', hash }
			controller?.receipt(hash, 'success')
		})
	} finally {
		await rendered.cleanup()
		transactionSteps.value?.cancel()
	}
})

test('closing the dialog during preparation cancels its captured scope before a review is published', async () => {
	const preparing = createDeferred<void>()
	const resume = createDeferred<void>()
	let completion: Promise<unknown> | undefined
	function Harness() {
		const [open, setOpen] = useState(true)
		return (
			<OperationModal confirmSingleStepFromForm isOpen={open} title='Withdraw REP' onClose={() => setOpen(false)}>
				<button
					type='button'
					onClick={() => {
						const controller = createTransactionStepController()
						controller.setPlan([step])
						completion = (async () => {
							preparing.resolve()
							await resume.promise
							return await controller.review()
						})().catch(error => error)
					}}
				>
					Withdraw REP
				</button>
			</OperationModal>
		)
	}
	const rendered = await renderIntoDocument(<Harness />)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Withdraw REP' })))
		await preparing.promise
		expect(transactionSteps.value).toBeUndefined()
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Close' })))
		resume.resolve()
		expect(isTransactionReviewCancellation(await completion)).toBe(true)
		expect(queries.queryByRole('dialog')).toBeNull()
		expect(transactionSteps.value).toBeUndefined()
	} finally {
		resume.resolve()
		await rendered.cleanup()
	}
})

test('keeps a single-action review by default for other app dialogs', async () => {
	const rendered = await renderIntoDocument(
		<OperationModal isOpen title='Queue liquidation' onClose={() => undefined}>
			<span>Form</span>
		</OperationModal>,
	)
	let controller: ReturnType<typeof createTransactionStepController> | undefined
	let review: Promise<bigint | undefined> | undefined
	try {
		await act(() => {
			controller = createTransactionStepController()
			controller.setPlan([{ ...step, title: 'Queue liquidation', amount: '2 REP', tokenFunding: [{ amount: '2 REP', limit: undefined }] }])
			review = controller.review().catch(() => undefined)
		})
		const dialog = within(document.body).getByRole('dialog', { name: 'Queue liquidation' })
		expect(transactionSteps.value?.steps[0]?.phase).toBe('review')
		expect(within(dialog).getByRole('button', { name: /^Queue liquidation/ })).not.toBeNull()
		expect(within(dialog).getByText('2 REP')).not.toBeNull()
	} finally {
		transactionSteps.value?.cancel()
		await review
		await rendered.cleanup()
	}
})
