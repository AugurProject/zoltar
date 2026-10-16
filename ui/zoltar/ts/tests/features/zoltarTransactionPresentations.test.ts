/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getOutcomeLabelForIndex } from '@zoltar/ui-zoltar-shared/features/universes/lib/migrationWizard.js'
import { createChildUniverseSuccessPresentation, createChildUniverseTransactionIntent, createChildUniverseWarningPresentation, createZoltarForkTransactionIntent, createZoltarMigrationTransactionIntent } from '@zoltar/ui-zoltar-shared/features/zoltarTransactionPresentations.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { getGenesisNetworkProfile, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { transactionScopesOverlap, universeTransactionScope } from '@zoltar/ui-core-shared/transactions/transactionScope.js'

const HASH = '0x00000000000000000000000000000000000000000000000000000000000000cd' as const

describe('child universe transaction presentations', () => {
	test('fork, child deployment, and migration intents lock only their genesis deployment', () => {
		const yes = getGenesisNetworkProfile(SEPOLIA_NETWORK_PROFILE, 'yes')
		const no = getGenesisNetworkProfile(SEPOLIA_NETWORK_PROFILE, 'no')
		try {
			for (const profile of [yes, no]) {
				installActiveEnvironmentForTesting(createFakeBackend({ profile }))
				const expectedScope = universeTransactionScope(0n, profile.genesisRepTokenAddress)
				for (const intent of [createZoltarForkTransactionIntent('approve', { universeId: 0n }), createZoltarForkTransactionIntent('fork', { universeId: 0n }), createChildUniverseTransactionIntent('zoltar', { universeId: 0n }), createZoltarMigrationTransactionIntent({ universeId: 0n })]) {
					expect(intent.scope).toEqual(expectedScope)
					expect(transactionScopesOverlap(intent.scope, universeTransactionScope(0n, (profile === yes ? no : yes).genesisRepTokenAddress))).toBeFalse()
				}
			}
		} finally {
			resetActiveEnvironmentForTesting()
		}
	})

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
