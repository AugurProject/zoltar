import { act } from 'preact/test-utils'
import { zeroAddress, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { createTransactionStepController, transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { isTransactionReviewCancellation } from '@zoltar/ui-core-shared/lib/errors.js'
import { createOracleManagerDetails, createSecurityVaultDetails } from './workflow/builders.js'
import { expect, test } from 'bun:test'
import { VaultBackingFactorForm } from '@zoltar/ui-statoblast-shared/features/security-pools/components/VaultBackingFactorForm.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { within, fireEvent, waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'

installDomEnvironment()
let cleanupRenderedComponent: (() => Promise<void>) | undefined
installDomTestLifecycle({
	afterTest: async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		transactionSteps.peek()?.cancel()
	},
})

test('shows approval buttons before the commitment send button without a review click', async () => {
	const rendered = await renderIntoDocument(<VaultBackingFactorForm details={undefined} oracleManagerDetails={createOracleManagerDetails({ isPriceValid: false })} blocker='Refresh vault details.' busy={false} pending={false} onAdjust={() => undefined} />)
	cleanupRenderedComponent = rendered.cleanup
	const page = within(document.body)
	const weth = page.getByRole('button', { name: 'Approve WETH' })
	const rep = page.getByRole('button', { name: 'Approve REP' })
	const send = page.getByRole('button', { name: 'Set commitment limit' })
	const buttons = [...document.querySelectorAll('button')]
	expect(buttons.indexOf(weth)).toBeLessThan(buttons.indexOf(rep))
	expect(buttons.indexOf(rep)).toBeLessThan(buttons.indexOf(send))
	expect(send.hasAttribute('disabled')).toBe(true)
})

async function renderPreparedForm(onAdjust: (limit: string, price?: bigint) => Promise<void>) {
	const rendered = await renderIntoDocument(<VaultBackingFactorForm details={createSecurityVaultDetails({ settlementCollateralAttoEth: 0n })} oracleManagerDetails={createOracleManagerDetails({ isPriceValid: false })} blocker={undefined} busy={false} pending={false} onAdjust={onAdjust} />)
	cleanupRenderedComponent = rendered.cleanup
	const page = within(document.body)
	fireEvent.input(page.getByLabelText('Commitment limit'), { target: { value: '1' } })
	fireEvent.input(page.getByLabelText('OpenOracle REP per ETH starting price'), { target: { value: '3' } })
	return page
}

function approvalPlan() {
	const base = { description: undefined, contractAddress: zeroAddress, contractLabel: undefined, spender: zeroAddress, amount: undefined, ethValueAttoEth: 0n }
	return [...['WETH', 'REP'].map(tokenSymbol => ({ ...base, title: `Approve ${tokenSymbol}`, approval: { requiredAmount: 10n ** 18n, approvedAmount: 0n, tokenSymbol, tokenUnits: 18 } })), { ...base, spender: undefined, title: 'Queue commitment limit' }]
}

test('prepares without writes, then sends each approval before the final operation', async () => {
	const sent: Array<{ index: number; amount: bigint | undefined }> = []
	const page = await renderPreparedForm(async () => {
		const controller = createTransactionStepController()
		controller.setPlan(approvalPlan())
		for (let index = 0; index < 3; index += 1) {
			const amount = await controller.review(index)
			sent.push({ index, amount })
			const hash: Hash = `0x${String(index + 1).repeat(64)}`
			controller.submitted(hash)
			controller.receipt(hash, 'success')
		}
	})
	await waitFor(() => expect(transactionSteps.value?.steps[0]?.phase).toBe('review'))
	await waitFor(() => expect(page.getByRole('button', { name: /Approve.*WETH/ }).hasAttribute('disabled')).toBe(false))
	expect(sent).toEqual([])
	expect(page.getAllByRole('button', { name: 'Set commitment limit' })).toHaveLength(1)
	expect(page.getByRole('button', { name: 'Set commitment limit' }).hasAttribute('disabled')).toBe(true)
	const positions = [...document.querySelectorAll('button')]
	expect(positions.indexOf(page.getByRole('button', { name: /Approve.*WETH/ }))).toBeLessThan(positions.indexOf(page.getByRole('button', { name: /Approve.*REP/ })))
	expect(positions.indexOf(page.getByRole('button', { name: /Approve.*REP/ }))).toBeLessThan(positions.indexOf(page.getByRole('button', { name: 'Set commitment limit' })))
	await act(() => fireEvent.input(page.getByLabelText('WETH approval amount'), { target: { value: '2' } }))
	await waitFor(() => expect(page.getByRole('button', { name: /Approve.*2.*WETH/ })).toBeDefined())
	fireEvent.click(page.getByRole('button', { name: /Approve.*WETH/ }))
	await waitFor(() => expect(transactionSteps.value?.steps[1]?.phase).toBe('review'))
	expect(sent).toEqual([{ index: 0, amount: 2n * 10n ** 18n }])
	expect(page.getByRole('button', { name: /WETH approved/ }).hasAttribute('disabled')).toBe(true)
	fireEvent.click(page.getByRole('button', { name: /Approve.*REP/ }))
	await waitFor(() => expect(transactionSteps.value?.steps[2]?.phase).toBe('review'))
	expect(sent.map(step => step.index)).toEqual([0, 1])
	fireEvent.click(page.getByRole('button', { name: 'Set commitment limit' }))
	await waitFor(() => expect(sent.map(step => step.index)).toEqual([0, 1, 2]))
})

test('editing inputs cancels the old preparation and exposes only the current plan', async () => {
	const prepared: string[] = []
	const sent: string[] = []
	const page = await renderPreparedForm(async limit => {
		prepared.push(limit)
		const controller = createTransactionStepController()
		controller.setPlan(approvalPlan())
		try {
			await controller.review(0)
			sent.push(limit)
		} catch (cause) {
			if (!isTransactionReviewCancellation(cause)) throw cause
		}
	})
	await waitFor(() => expect(prepared).toEqual(['1']))
	const oldWorkflow = transactionSteps.value
	fireEvent.input(page.getByLabelText('Commitment limit'), { target: { value: '0' } })
	await waitFor(() => expect(prepared).toEqual(['1', '0']))
	oldWorkflow?.confirmStep(0)
	expect(sent).toEqual([])
	expect(transactionSteps.value?.reviewSignal).not.toBe(oldWorkflow?.reviewSignal)
})

test('retains a failed approval plan and retries without sending the final operation', async () => {
	let attempts = 0
	const page = await renderPreparedForm(async () => {
		attempts += 1
		const controller = createTransactionStepController()
		controller.setPlan(approvalPlan())
		try {
			await controller.review(0)
			controller.failed({ kind: 'error', message: 'Wallet rejected approval' })
		} catch (cause) {
			if (!isTransactionReviewCancellation(cause)) throw cause
		}
	})
	await waitFor(() => expect(transactionSteps.value?.steps[0]?.phase).toBe('review'))
	fireEvent.click(page.getByRole('button', { name: /Approve.*WETH/ }))
	await waitFor(() => expect(page.getByRole('button', { name: 'Retry' })).toBeDefined())
	expect(page.getByRole('button', { name: 'Set commitment limit' }).hasAttribute('disabled')).toBe(true)
	fireEvent.click(page.getByRole('button', { name: 'Retry' }))
	await waitFor(() => expect(attempts).toBe(2))
	expect(transactionSteps.value?.steps[0]?.phase).toBe('review')
})

test('prepares again when invalid inputs are restored to the same values', async () => {
	let attempts = 0
	const page = await renderPreparedForm(async () => {
		attempts += 1
		const controller = createTransactionStepController()
		controller.setPlan(approvalPlan())
		try {
			await controller.review(0)
		} catch (cause) {
			if (!isTransactionReviewCancellation(cause)) throw cause
		}
	})
	await waitFor(() => expect(attempts).toBe(1))
	fireEvent.input(page.getByLabelText('Commitment limit'), { target: { value: '' } })
	await waitFor(() => expect(transactionSteps.value?.steps[0]?.phase).not.toBe('review'))
	fireEvent.input(page.getByLabelText('Commitment limit'), { target: { value: '1' } })
	await waitFor(() => expect(attempts).toBe(2))
	expect(transactionSteps.value?.steps[0]?.phase).toBe('review')
})
