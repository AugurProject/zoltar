export function normalizeCaseInsensitiveText(value: string | undefined) {
	return value?.trim().toLowerCase()
}

export function sameCaseInsensitiveText(left: string | undefined, right: string | undefined) {
	const normalizedLeft = normalizeCaseInsensitiveText(left)
	const normalizedRight = normalizeCaseInsensitiveText(right)
	return normalizedLeft !== undefined && normalizedLeft === normalizedRight
}
