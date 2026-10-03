/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { buildUniverseLineageLabels, extendUniverseLineage, formatUniverseLineageLabel, formatUniverseStepName, formatUniverseViewLabel } from '../lib/universeLineage.js'
import { formatShortUniverseId } from '../lib/universeLabels.js'

const yesUniverseId = BigInt('0x3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb5')
const noUniverseId = BigInt('0xeef7e35abe7026729641147f7915573c7e97b47efa546f5f6e3230263bcb49')
const lineage = [
	{ outcomeLabel: undefined, universeId: 0n },
	{ outcomeLabel: 'Yes', universeId: yesUniverseId },
	{ outcomeLabel: 'No', universeId: noUniverseId },
]

test('view scope keeps summary names stable while migration can display ancestry', () => {
	const full = { lineage, outcomeLabel: 'No', universeId: noUniverseId, childUniverses: [] }
	expect(formatUniverseViewLabel(full, noUniverseId, false)).toBe('No')
	expect(formatUniverseViewLabel({ outcomeLabel: 'No' }, noUniverseId, false)).toBe('No')
	expect(formatUniverseViewLabel(full, noUniverseId, true)).toBe('Genesis › Yes › No')
	expect(formatUniverseViewLabel(full, 0n, false)).toBe('Genesis')
	const names = buildUniverseLineageLabels(full, false)
	expect(names.get(noUniverseId.toString())).toBe('No')
	expect(names.get(yesUniverseId.toString())).toBeUndefined()
	expect(formatUniverseViewLabel({ lineage }, yesUniverseId, false)).toBe(`Universe ${formatShortUniverseId(yesUniverseId)}`)
})

describe('universe lineage labels', () => {
	test('names a universe by the fork outcomes from Genesis', () => {
		expect(formatUniverseLineageLabel(lineage, noUniverseId)).toBe('Genesis › Yes › No')
		expect(formatUniverseLineageLabel(lineage.slice(0, 2), yesUniverseId)).toBe('Genesis › Yes')
		expect(formatUniverseLineageLabel(undefined, 0n)).toBe('Genesis')
	})

	test('falls back to a short hex id when the lineage is missing or does not end at the universe', () => {
		expect(formatShortUniverseId(yesUniverseId)).toBe('0x3228b6…5fb5')
		expect(formatShortUniverseId(10n)).toBe('0xa')
		expect(formatUniverseLineageLabel(undefined, yesUniverseId)).toBe('Universe 0x3228b6…5fb5')
		expect(formatUniverseLineageLabel(lineage, yesUniverseId)).toBe('Universe 0x3228b6…5fb5')
		expect(formatUniverseLineageLabel(lineage.slice(1), noUniverseId)).toBe('Universe 0xeef7e3…cb49')
	})

	test('uses the short hex id for a generation whose outcome name is unknown or blank', () => {
		expect(formatUniverseStepName({ outcomeLabel: undefined, universeId: yesUniverseId })).toBe('0x3228b6…5fb5')
		expect(formatUniverseStepName({ outcomeLabel: '  ', universeId: yesUniverseId })).toBe('0x3228b6…5fb5')
		expect(formatUniverseStepName({ outcomeLabel: 'Invalid', universeId: yesUniverseId })).toBe('Invalid')
		expect(
			formatUniverseLineageLabel(
				[
					{ outcomeLabel: undefined, universeId: 0n },
					{ outcomeLabel: undefined, universeId: yesUniverseId },
				],
				yesUniverseId,
			),
		).toBe('Genesis › 0x3228b6…5fb5')
	})

	test('extends a known lineage with a child outcome and keeps an unknown lineage unknown', () => {
		expect(extendUniverseLineage(lineage.slice(0, 1), { outcomeLabel: 'Yes', universeId: yesUniverseId })).toEqual(lineage.slice(0, 2))
		expect(extendUniverseLineage(undefined, { outcomeLabel: 'Yes', universeId: yesUniverseId })).toBeUndefined()
	})

	test('builds names for the ancestors, the universe, and its children', () => {
		const labels = buildUniverseLineageLabels({
			childUniverses: [{ outcomeLabel: 'Alpha', universeId: 99n }],
			lineage: lineage.slice(0, 2),
			universeId: yesUniverseId,
		})
		expect(labels.get('0')).toBe('Genesis')
		expect(labels.get(yesUniverseId.toString())).toBe('Genesis › Yes')
		expect(labels.get('99')).toBe('Genesis › Yes › Alpha')
	})

	test('names the selected outcome without an ancestry walk and retains complete lineage when available', () => {
		expect([...buildUniverseLineageLabels({ childUniverses: [], outcomeLabel: ' Yes ', universeId: yesUniverseId })]).toEqual([
			['0', 'Genesis'],
			[yesUniverseId.toString(), 'Yes'],
		])
		expect(buildUniverseLineageLabels({ childUniverses: [], outcomeLabel: 'No', lineage, universeId: noUniverseId }).get(noUniverseId.toString())).toBe('Genesis › Yes › No')
		expect([...buildUniverseLineageLabels({ childUniverses: [], outcomeLabel: ' ', universeId: yesUniverseId })]).toEqual([['0', 'Genesis']])
	})

	test('knows only Genesis when the lineage is missing or incomplete', () => {
		expect([...buildUniverseLineageLabels(undefined)]).toEqual([['0', 'Genesis']])
		expect([...buildUniverseLineageLabels({ childUniverses: [{ outcomeLabel: 'Alpha', universeId: 99n }], lineage: undefined, universeId: yesUniverseId })]).toEqual([['0', 'Genesis']])
	})
})
