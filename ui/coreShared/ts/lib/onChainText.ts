/**
 * Control, format, line-separator and filler characters that can hide, reorder or blank on-chain text: C0 and C1 controls,
 * the soft hyphen, bidi marks, embeddings, overrides and isolates (U+061C, U+200E-U+200F, U+202A-U+202E, U+2066-U+2069),
 * zero-width and invisible operators (U+200B-U+200D, U+2060-U+2064), the byte-order mark, tag characters, and Hangul fillers.
 */
const HIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}ᅟᅠㅤﾠ]/gu

/**
 * Untrusted on-chain text (outcome labels, question titles, units) shown with each hidden character replaced by a visible
 * `\u{XXXX}` escape, so two labels that render alike stay distinguishable and a bidi override cannot reorder nearby text.
 * Look-alike letters from other scripts are left as they are; callers show an immutable identifier beside the text.
 */
export function escapeOnChainText(text: string) {
	return text.replace(HIDDEN_CHARACTER, character => `\\u{${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}}`)
}
