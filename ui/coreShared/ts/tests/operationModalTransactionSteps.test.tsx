/// <reference types="bun-types" />

import { expect, test } from 'bun:test'
import { signal } from '@preact/signals'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { GlobalTransactionPresentationProvider } from '../components/GlobalTransactionPresentationContext.js'
import { OperationModal } from '../components/OperationModal.js'
import { TransactionStepsModal } from '../components/TransactionStepsModal.js'
import { createTransactionStepController, transactionSteps } from '../transactions/transactionSteps.js'
import type { GlobalTransactionPresentation } from '../types/components.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { fireEvent, within } from './testUtils/queries.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

installDomTestLifecycle()

const hash = '0x1111111111111111111111111111111111111111111111111111111111111111'
const step = { title: 'Send withdrawal', description: 'Withdraw REP.', contractAddress: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }

for (const outcome of ['success', 'failure', 'approval', 'cancel', 'multi-step'] as const) {
	test(`keeps transaction review in its initiating dialog through ${outcome}`, async () => {
		const presentation = signal<GlobalTransactionPresentation | undefined>(undefined)
		const completedHash = signal<string | undefined>(undefined)
		let controller: ReturnType<typeof createTransactionStepController> | undefined
		let review: Promise<bigint | undefined> | undefined
		function Harness() {
			const [open, setOpen] = useState(true)
			return (
				<GlobalTransactionPresentationProvider transaction={presentation.value}>
					<OperationModal isOpen={open} title='Withdraw REP' closeOnSuccessKey={completedHash.value} onClose={() => setOpen(false)}>
						<input aria-label='Amount' defaultValue='42' />
						<button
							type='button'
							onClick={() => {
								presentation.value = { operationKey: 'withdrawal', title: 'Preparing withdrawal', tone: 'preparing' }
								controller = createTransactionStepController()
								controller.setPlan(outcome === 'multi-step' ? [{ ...step, title: 'Approve REP' }, step] : [step])
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
			await act(() => fireEvent.click(queries.getByRole('button', { name: 'Review withdrawal' })))
			expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
			expect(queries.getByRole('dialog')).toBe(dialog)
			if (controller === undefined) throw new Error('Missing transaction controller')
			if (outcome === 'cancel') {
				await act(() => fireEvent.click(queries.getByRole('button', { name: 'Cancel' })))
				await review
				expect(queries.queryByRole('dialog')).toBeNull()
				expect(transactionSteps.value).toBeUndefined()
				return
			}
			await act(() => fireEvent.click(queries.getByRole('button', { name: outcome === 'multi-step' ? 'Approve REP' : 'Send withdrawal' })))
			await review
			const firstHash = outcome === 'multi-step' ? '0x2222222222222222222222222222222222222222222222222222222222222222' : hash
			await act(() => {
				controller?.submitted(firstHash)
				presentation.value = { operationKey: 'withdrawal', title: 'Withdrawal pending', tone: 'pending', hash: firstHash }
			})
			expect(queries.getByRole('dialog')).toBe(dialog)
			expect(queries.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(true)
			await act(() => fireEvent.keyDown(dialog, { key: 'Escape' }))
			expect(queries.getByRole('dialog')).toBe(dialog)
			if (outcome === 'multi-step') {
				await act(() => {
					controller?.receipt(firstHash, 'success')
					review = controller?.review(1).catch(() => undefined)
				})
				expect(queries.getByRole('dialog')).toBe(dialog)
				for (const unrelatedHash of [undefined, '0x33']) {
					await act(() => {
						presentation.value = { tone: 'success', title: 'Unrelated transaction confirmed', ...(unrelatedHash === undefined ? {} : { hash: unrelatedHash }), operationKey: 'unrelated' }
					})
					expect(transactionSteps.value?.steps[1]?.phase).toBe('review')
				}
				expect(queries.getByRole('dialog')).toBe(dialog)
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
				expect(queries.queryByRole('dialog')).toBeNull()
				expect(transactionSteps.value).toBeUndefined()
			} else {
				expect(queries.getByRole('dialog')).toBe(dialog)
				if (outcome === 'failure') {
					expect(queries.getByRole('alert').textContent).toContain('Transaction reverted')
					await act(() => fireEvent.click(queries.getByRole('button', { name: 'Back' })))
					expect(dialog.querySelector('.operation-modal-transaction-notice') === null).toBe(true)
				} else {
					expect(dialog.querySelector('.operation-modal-transaction-notice') !== null).toBe(true)
				}
				expect(queries.getByRole('textbox', { name: 'Amount' }).getAttribute('value')).toBe('42')
				expect(transactionSteps.value).toBeUndefined()
			}
		} finally {
			await rendered.cleanup()
			transactionSteps.value?.cancel()
		}
	})
}
