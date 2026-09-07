import { describe, expect, test } from 'bun:test'
import { capabilitiesForTradingVersion, requireTradingVersion } from '../../protocol/capabilities.js'

describe('trading deployment capabilities', () => {
	test('treats omitted and V1 deployment metadata as legacy', () => {
		expect(capabilitiesForTradingVersion(undefined)).toEqual({ receiveBasedShareOperations: false, directLiquidityRemovalDeadline: false, lpTokenPermit: false })
		expect(capabilitiesForTradingVersion(1)).toEqual(capabilitiesForTradingVersion(undefined))
	})

	test('selects receive-based shares, direct removal deadlines, and LP permits only for V2', () => {
		expect(capabilitiesForTradingVersion(2)).toEqual({ receiveBasedShareOperations: true, directLiquidityRemovalDeadline: true, lpTokenPermit: true })
	})

	test('rejects unknown versions instead of guessing contract capabilities', () => {
		expect(requireTradingVersion(1)).toBe(1)
		expect(requireTradingVersion(2)).toBe(2)
		expect(() => requireTradingVersion(3)).toThrow('1 or 2')
	})
})
