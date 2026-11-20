import { expect, test } from 'bun:test'
import { hasTimelineSearchTrigram } from '../../src/timeline-search.ts'

test('unscoped timeline search requires an internal word trigram, including Unicode', () => {
	for (const query of ['', 'zz', '!!!', 'a!b!c', 'ab cd', '%_%', '\\%_']) expect(hasTimelineSearchTrigram(query)).toBe(false)
	for (const query of ['abc', 'ReportDisputed', '123', 'éàö', '漢字語', '%abc_']) expect(hasTimelineSearchTrigram(query)).toBe(true)
})
