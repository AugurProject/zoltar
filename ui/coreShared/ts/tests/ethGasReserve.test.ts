/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { ETH_GAS_RESERVE_ATTO_ETH, getSpendableEthBalance } from '../lib/ethGasReserve.js'

describe('ETH gas reserve', () => {
	test('keeps 0.01 ETH in the wallet for gas', () => {
		expect(ETH_GAS_RESERVE_ATTO_ETH).toBe(10n ** 16n)
		expect(getSpendableEthBalance(10n ** 18n)).toBe(10n ** 18n - 10n ** 16n)
	})

	test('never returns a negative amount when the balance does not cover the reserve', () => {
		expect(getSpendableEthBalance(0n)).toBe(0n)
		expect(getSpendableEthBalance(ETH_GAS_RESERVE_ATTO_ETH - 1n)).toBe(0n)
		expect(getSpendableEthBalance(ETH_GAS_RESERVE_ATTO_ETH)).toBe(0n)
		expect(getSpendableEthBalance(ETH_GAS_RESERVE_ATTO_ETH + 1n)).toBe(1n)
	})
})
