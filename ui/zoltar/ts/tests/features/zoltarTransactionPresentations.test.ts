/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getOutcomeLabelForIndex } from '@zoltar/ui-zoltar-shared/features/universes/lib/migrationWizard.js'
import { createChildUniverseSuccessPresentation, createChildUniverseTransactionIntent, createChildUniverseWarningPresentation } from '@zoltar/ui-zoltar-shared/features/zoltarTransactionPresentations.js'

const HASH = '0x00000000000000000000000000000000000000000000000000000000000000cd' as const

describe('child universe transaction presentations', () => {
	test('name the outcome instead of its index', () => {
		const result = { action: 'createChildUniverse' as const, hash: HASH, outcomeIndex: 2n, universeId: 1n }
		expect(createChildUniverseTransactionIntent('zoltar', { outcomeLabel: 'No', universeId: 1n })).toMatchObject({ rows: [{ label: 'Outcome', value: 'No' }] })
		expect(createChildUniverseSuccessPresentation(result, 'No')).toMatchObject({ rows: [{ label: 'Outcome', value: 'No' }] })
		expect(createChildUniverseWarningPresentation(result, 'No', 'Refresh failed')).toMatchObject({ rows: [{ label: 'Outcome', value: 'No' }] })
	})

	test('fall back to a position when the universe summary is unavailable', () => {
		expect(createChildUniverseTransactionIntent('zoltar', { outcomeLabel: getOutcomeLabelForIndex(undefined, 2n) })).toMatchObject({ rows: [{ label: 'Outcome', value: 'Outcome 3' }] })
	})
})
