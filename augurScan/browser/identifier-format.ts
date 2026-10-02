// Matches the UI and bot abbreviation: 8 leading and 6 trailing characters, leaving values that would not shrink unchanged.
export const short = (value: string | readonly unknown[] | null | undefined, front = 8, back = 6): string => {
	if (value === null || value === undefined || value.length === 0) return '—'
	if (value.length <= front + back + 1) return String(value)
	return `${value.slice(0, front)}…${value.slice(-back)}`
}

export const shortIdentifier = (value: string, front = 8, back = 6) => short(String(value ?? ''), front, back)

export function questionIdHex(value: string | null | undefined) {
	if (value === undefined || value === null || !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) return '—'
	return `0x${BigInt(value).toString(16)}`
}
