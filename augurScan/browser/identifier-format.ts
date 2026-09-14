export const short = (value: string | readonly unknown[] | null | undefined, front = 6, back = 4): string => (value ? `${value.slice(0, front)}…${value.slice(-back)}` : '—')

export const shortIdentifier = (value: string, front = 6, back = 4) => {
	const text = String(value ?? '')
	return text.length > front + back + 1 ? short(text, front, back) : text || '—'
}
