/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
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
		</OperationModal>
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

	test('keeps focus on the edited input while the modal rerenders', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(<OperationModalHarness />, container)
		})

		const amountInput = within(container).getByLabelText('Amount') as HTMLInputElement

		await act(() => {
			amountInput.focus()
		})
		expect(document.activeElement).toBe(amountInput)

		await act(() => {
			fireEvent.input(amountInput, { target: { value: '12' } })
		})

		const rerenderedInput = within(container).getByLabelText('Amount') as HTMLInputElement
		expect(rerenderedInput.value).toBe('12')
		expect(document.activeElement).toBe(rerenderedInput)

		render(null, container)
		container.remove()
	})
})
