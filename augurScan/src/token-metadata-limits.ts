/** Display metadata is untrusted and is repeated in decoded records. Limits are UTF-8 bytes. */
const TOKEN_NAME_MAX_BYTES = 256
const TOKEN_SYMBOL_MAX_BYTES = 64
const encoder = new TextEncoder()
const maximumBytes = (field: 'name' | 'symbol') => (field === 'name' ? TOKEN_NAME_MAX_BYTES : TOKEN_SYMBOL_MAX_BYTES)

export function tokenMetadataText(value: string, field: 'name' | 'symbol'): string {
	const maximum = maximumBytes(field)
	if (encoder.encode(value).length > maximum) throw Object.assign(new Error(`ERC-20 metadata exceeds ${field} limit of ${maximum} bytes`), { name: 'TokenMetadataContractError' })
	return value
}

/** Old stored metadata must satisfy the same bounds as fresh reads before display. */
export function tokenDisplayText(value: string | undefined, field: 'name' | 'symbol'): string | undefined {
	if (value === undefined) return undefined
	return encoder.encode(value).length <= maximumBytes(field) ? value : undefined
}
