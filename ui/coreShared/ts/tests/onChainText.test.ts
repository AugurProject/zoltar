import { describe, expect, test } from 'bun:test'
import { escapeOnChainText } from '../lib/onChainText.js'

describe('escapeOnChainText (#1477)', () => {
	test('leaves ordinary text, including look-alike letters, unchanged', () => {
		expect(escapeOnChainText('Yes')).toBe('Yes')
		expect(escapeOnChainText('Yеs')).toBe('Yеs')
		expect(escapeOnChainText('No, Yes 100 °C')).toBe('No, Yes 100 °C')
	})

	test('shows bidi controls, invisible and control characters as visible escapes', () => {
		expect(escapeOnChainText('‮seY')).toBe('\\u{202E}seY')
		expect(escapeOnChainText('Yes⁣')).toBe('Yes\\u{2063}')
		const hidden = ['‪', '‫', '‬', '‭', '⁦', '⁧', '⁨', '⁩', '​', '‌', '‍', '‎', '‏', '⁠', '⁡', '⁢', '⁤', '﻿', '؜', '­', '\u0000', '\u0007', '\u001B', '\n', '\u007F', '\u0085', '\u009F', ' ', ' ']
		for (const character of hidden) {
			const escaped = escapeOnChainText(`a${character}b`)
			expect(escaped).toBe(`a\\u{${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}}b`)
		}
	})

	test('escapes astral format characters by their full code point', () => {
		expect(escapeOnChainText('Yes\u{E0001}')).toBe('Yes\\u{E0001}')
	})
})
