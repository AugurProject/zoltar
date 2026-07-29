export function markdownHeadingIds(text: string): string[] {
	const headingIds: string[] = []
	const slugCounts = new Map<string, number>()
	for (const line of text.split('\n')) {
		const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
		const headingText = heading?.[2]
		if (headingText === undefined) continue

		const baseSlug = markdownHeadingToSlug(headingText)
		const priorCount = slugCounts.get(baseSlug) ?? 0
		slugCounts.set(baseSlug, priorCount + 1)
		headingIds.push(priorCount === 0 ? baseSlug : `${baseSlug}-${priorCount}`)
	}
	return headingIds
}

function markdownHeadingToSlug(headingText: string): string {
	return headingText
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9 -]/g, '')
		.replace(/\s+/g, '-')
}
