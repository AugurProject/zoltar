/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { buildUniverseLineageLabels, extendUniverseLineage, formatUniverseLineageLabel, formatUniverseStepName, formatUniverseViewLabel } from '../lib/universeLineage.js'
import { formatShortUniverseId, formatUniverseDisplayLabel, formatUniverseLabel } from '../lib/universeLabels.js'
import { getGenesisNetworkProfile, resetRuntimeNetworkProfile, SEPOLIA_NETWORK_PROFILE, setRuntimeNetworkProfile } from '../wallet/networkProfile.js'

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
	expect(formatUniverseViewLabel(full, noUniverseId, true)).toBe('Augur v2 › Yes › Yes › No')
	expect(formatUniverseViewLabel(full, 0n, false)).toBe('Augur v2 › Yes')
	const names = buildUniverseLineageLabels(full, false)
	expect(names.get(noUniverseId.toString())).toBe('No')
	expect(names.get(yesUniverseId.toString())).toBeUndefined()
	expect(formatUniverseViewLabel({ lineage }, yesUniverseId, false)).toBe(`Universe ${formatShortUniverseId(yesUniverseId)}`)
})

describe('universe lineage labels', () => {
	test('names a universe by the fork outcomes from Genesis', () => {
		expect(formatUniverseLineageLabel(lineage, noUniverseId)).toBe('Augur v2 › Yes › Yes › No')
		expect(formatUniverseLineageLabel(lineage.slice(0, 2), yesUniverseId)).toBe('Augur v2 › Yes › Yes')
		expect(formatUniverseLineageLabel(undefined, 0n)).toBe('Augur v2 › Yes')
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
		).toBe('Augur v2 › Yes › 0x3228b6…5fb5')
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
		expect(labels.get('0')).toBe('Augur v2 › Yes')
		expect(labels.get(yesUniverseId.toString())).toBe('Augur v2 › Yes › Yes')
		expect(labels.get('99')).toBe('Augur v2 › Yes › Yes › Alpha')
	})

	test('names the selected outcome without an ancestry walk and retains complete lineage when available', () => {
		expect([...buildUniverseLineageLabels({ childUniverses: [], outcomeLabel: ' Yes ', universeId: yesUniverseId })]).toEqual([
			['0', 'Augur v2 › Yes'],
			[yesUniverseId.toString(), 'Yes'],
		])
		expect(buildUniverseLineageLabels({ childUniverses: [], outcomeLabel: 'No', lineage, universeId: noUniverseId }).get(noUniverseId.toString())).toBe('Augur v2 › Yes › Yes › No')
		expect([...buildUniverseLineageLabels({ childUniverses: [], outcomeLabel: ' ', universeId: yesUniverseId })]).toEqual([['0', 'Augur v2 › Yes']])
	})

	test('knows only Genesis when the lineage is missing or incomplete', () => {
		expect([...buildUniverseLineageLabels(undefined)]).toEqual([['0', 'Augur v2 › Yes']])
		expect([...buildUniverseLineageLabels({ childUniverses: [{ outcomeLabel: 'Alpha', universeId: 99n }], lineage: undefined, universeId: yesUniverseId })]).toEqual([['0', 'Augur v2 › Yes']])
	})
})

test('names the canonical root from the active profile without a browser URL', () => {
	setRuntimeNetworkProfile(getGenesisNetworkProfile(SEPOLIA_NETWORK_PROFILE, 'no'))
	try {
		expect(formatUniverseLineageLabel(undefined, 0n)).toBe('Augur v2 › No')
		expect(formatUniverseLabel(0n)).toBe('Augur v2 › No (0x0)')
		expect(formatUniverseDisplayLabel(0n)).toBe('Augur v2 › No (0x0)')
		expect(formatUniverseLineageLabel(lineage, noUniverseId)).toBe('Augur v2 › No › Yes › No')
		expect(buildUniverseLineageLabels(undefined).get('0')).toBe('Augur v2 › No')
	} finally {
		resetRuntimeNetworkProfile()
	}
})
