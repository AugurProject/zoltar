export function publicInformationalOperationValue(value: string | undefined) {
	if (value === undefined) return undefined
	if (/^(?:[A-Za-z]:[\\/]|[/~.]\/)/.test(value) || /(?:api[_-]?key|authorization|bearer|password|secret|token)\s*[=:]\s*\S+/i.test(value)) return undefined
	const urlMatches = [...value.matchAll(/https?:\/\/[^\s,;)]+/gi)]
	for (const match of urlMatches) {
		try {
			const url = new URL(match[0])
			if (url.username !== '' || url.password !== '' || (url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') return undefined
		} catch (error) {
			void error
			return undefined
		}
	}
	const nonUrlValue = urlMatches.reduce((remaining, match) => remaining.replace(match[0], ''), value)
	if (/[\\/]/.test(nonUrlValue)) return undefined
	return value
}
