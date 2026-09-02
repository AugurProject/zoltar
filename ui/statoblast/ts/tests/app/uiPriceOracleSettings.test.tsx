/// <reference types='bun-types' />

import { expect, mock, test } from 'bun:test'
import { UiPriceOracleSettings, readUiPriceOracle } from '../../app/UiPriceOracleSettings.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

test('falls back safely when browser storage cannot be acquired', () => {
	const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
	try {
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			get: () => {
				throw new DOMException('Storage unavailable', 'SecurityError')
			},
		})
		expect(readUiPriceOracle()).toBe('open-oracle-fallback')
	} finally {
		if (originalDescriptor === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
		else Object.defineProperty(globalThis, 'localStorage', originalDescriptor)
	}
})

test('propagates unexpected browser storage read failures', () => {
	expect(() =>
		readUiPriceOracle({
			getItem: () => {
				throw new DOMException('Unexpected storage failure', 'InvalidStateError')
			},
		}),
	).toThrow('Unexpected storage failure')
})

test('applies an oracle choice in memory and reports a storage write failure', async () => {
	const domEnvironment = installDomEnvironment('http://localhost/#/markets')
	const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: () => null,
			setItem: () => {
				throw new DOMException('Storage denied', 'QuotaExceededError')
			},
		},
	})
	const onPriceOracleChange = mock(() => undefined)
	const rendered = await renderIntoDocument(<UiPriceOracleSettings priceOracle='open-oracle-fallback' onPriceOracleChange={onPriceOracleChange} />)
	try {
		const queries = within(rendered.container)
		const priceSelect = rendered.container.querySelector('select')
		if (priceSelect?.tagName !== 'SELECT') throw new Error('Expected UI price oracle selector')
		fireEvent.change(priceSelect, { target: { value: 'uniswap' } })
		expect(onPriceOracleChange).toHaveBeenCalledWith('uniswap')
		expect(queries.getByRole('alert').textContent).toContain('Storage denied')
	} finally {
		await rendered.cleanup()
		if (originalDescriptor === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
		else Object.defineProperty(globalThis, 'localStorage', originalDescriptor)
		domEnvironment.cleanup()
	}
})
