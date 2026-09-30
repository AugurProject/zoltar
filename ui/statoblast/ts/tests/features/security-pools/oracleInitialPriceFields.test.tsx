import { expect, test } from 'bun:test'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { OracleInitialPriceFields, parseOracleInitialPrice, type OracleInitialPriceInput } from '@zoltar/ui-statoblast-shared/features/security-pools/components/OracleInitialPriceFields.js'

function PriceHarness({ fetchPrice }: { fetchPrice: () => Promise<bigint> }) {
	const [value, onChange] = useState<OracleInitialPriceInput>({ price: '' })
	return (
		<>
			<OracleInitialPriceFields managerAddress={zeroAddress} fieldId='initial-price' value={value} onChange={onChange} disabled={false} fetchPrice={fetchPrice} />
			<button disabled={parseOracleInitialPrice(value).error !== undefined}>Submit</button>
		</>
	)
}

test('fetches an explicit starting price and preserves manual edits over late quotes', async () => {
	const dom = installDomEnvironment()
	let quote = createDeferred<bigint>()
	const rendered = await renderIntoDocument(<PriceHarness fetchPrice={async () => await quote.promise} />)
	try {
		const page = within(document.body)
		const input = page.getByRole('textbox', { name: 'Open Oracle REP per ETH starting price' })
		const submit = page.getByRole('button', { name: 'Submit' })
		expect(submit.hasAttribute('disabled')).toBe(true)
		await act(async () => {
			fireEvent.click(page.getByRole('button', { name: 'Fetch from Uniswap' }))
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(submit.hasAttribute('disabled')).toBe(true)
		await act(async () => {
			quote.resolve(25n * 10n ** 17n)
			await quote.promise
		})
		expect(input instanceof HTMLInputElement && input.value).toBe('2.5')
		expect(submit.hasAttribute('disabled')).toBe(false)
		quote = createDeferred<bigint>()
		await act(async () => {
			fireEvent.click(page.getByRole('button', { name: 'Fetch from Uniswap' }))
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(submit.hasAttribute('disabled')).toBe(true)
		await act(() => fireEvent.input(input, { target: { value: '3' } }))
		await act(() => quote.resolve(4n * 10n ** 18n))
		expect(input instanceof HTMLInputElement && input.value).toBe('3')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('keeps quote failures inline and allows retry or manual pricing', async () => {
	const dom = installDomEnvironment()
	let fail = true
	const rendered = await renderIntoDocument(
		<PriceHarness
			fetchPrice={async () => {
				if (fail) throw new Error('Quote unavailable')
				return 2n * 10n ** 18n
			}}
		/>,
	)
	try {
		const page = within(document.body)
		await act(async () => {
			fireEvent.click(page.getByRole('button', { name: 'Fetch from Uniswap' }))
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(document.body.textContent).toContain('Quote unavailable')
		expect(page.getByRole('button', { name: 'Submit' }).hasAttribute('disabled')).toBe(true)
		fail = false
		await act(async () => {
			fireEvent.click(page.getByRole('button', { name: 'Fetch from Uniswap' }))
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(document.body.textContent).not.toContain('Quote unavailable')
		expect(page.getByRole('button', { name: 'Submit' }).hasAttribute('disabled')).toBe(false)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})
