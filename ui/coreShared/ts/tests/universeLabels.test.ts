import { describe, expect, test } from 'bun:test'
import { formatDistinctUniverseDisplayLabels, formatUniverseDisplayLabel, formatUniverseLabel } from '../lib/universeLabels.js'

describe('universe labels', () => {
	test('keeps genesis and short IDs in full and abbreviates long IDs', () => {
		expect(formatUniverseDisplayLabel(0n)).toBe('Genesis (0x0)')
		expect(formatUniverseDisplayLabel(7n)).toBe('Universe 0x7')
		const longUniverseId = (1n << 200n) + 456n
		expect(formatUniverseDisplayLabel(longUniverseId)).toBe(`Universe 0x${longUniverseId.toString(16).slice(0, 8)}…${longUniverseId.toString(16).slice(-6)}`)
	})

	test('widens colliding abbreviations only as far as needed instead of falling back to full IDs', () => {
		// Same leading 8 and trailing 6 hex digits, different middle: the default compact form would read identically.
		const first = (0xabcdef12n << 96n) | (1n << 40n) | 0x123456n
		const second = (0xabcdef12n << 96n) | (2n << 40n) | 0x123456n
		const labels = formatDistinctUniverseDisplayLabels([0n, first, second])
		expect(labels[0]).toBe('Genesis (0x0)')
		expect(labels[1]).not.toBe(labels[2])
		// The differing digit is the 11th from the end, so a 10-digit suffix still collides and the next step (14) separates them.
		expect(labels[1]).toBe(`Universe 0x${first.toString(16).slice(0, 8)}…${first.toString(16).slice(-14)}`)
		expect(labels[2]).toBe(`Universe 0x${second.toString(16).slice(0, 8)}…${second.toString(16).slice(-14)}`)
		for (const label of labels) expect(label.length).toBeLessThanOrEqual(34)
	})

	test('leaves non-colliding sets at the default compact width', () => {
		const longUniverseId = (1n << 200n) + 456n
		expect(formatDistinctUniverseDisplayLabels([0n, 7n, longUniverseId])).toEqual([formatUniverseLabel(0n), formatUniverseLabel(7n), formatUniverseDisplayLabel(longUniverseId)])
	})

	test('caps the widened suffix at a phone-friendly width and falls back to full labels beyond it', () => {
		// Same eight leading digits and same trailing 18 digits: the widest compact suffix still collides, so only the full ID tells them apart.
		const first = (0xabcdef12n << 96n) | (1n << 76n) | 0x123456n
		const second = (0xabcdef12n << 96n) | (2n << 76n) | 0x123456n
		expect(formatDistinctUniverseDisplayLabels([first, second])).toEqual([formatUniverseLabel(first), formatUniverseLabel(second)])
		// One digit inside the widest suffix keeps the set compact, at the maximum label length the toolbar slot is sized for.
		const separable = (0xabcdef12n << 96n) | (2n << 68n) | 0x123456n
		const labels = formatDistinctUniverseDisplayLabels([first, separable])
		expect(new Set(labels).size).toBe(2)
		for (const label of labels) expect(label.length).toBe('Universe 0x'.length + 8 + 1 + 18)
	})
})
