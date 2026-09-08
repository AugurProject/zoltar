export function publicErrorMessage(error: unknown, fallback: string) {
	if (!(error instanceof Error)) return fallback
	const detail = error.message.trim()
	if (detail.length === 0) return fallback
	if (/(?<![0-9a-f])0x[0-9a-f]{40}(?![0-9a-f])|share[ -]?token|token[ _-]?id|contract address|call (?:arguments?|args)|\bargs?:/i.test(detail)) return fallback
	return detail
}
