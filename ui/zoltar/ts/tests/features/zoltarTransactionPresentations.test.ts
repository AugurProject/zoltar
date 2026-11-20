/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { Fragment, h, render } from 'preact'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { getMigrationOutcomeTextForIndex, getOutcomeLabelForIndex } from '@zoltar/ui-zoltar-shared/features/universes/lib/migrationWizard.js'
import { createChildUniverseSuccessPresentation, createChildUniverseTransactionIntent, createChildUniverseWarningPresentation, createZoltarForkTransactionIntent, createZoltarMigrationTransactionIntent } from '@zoltar/ui-zoltar-shared/features/zoltarTransactionPresentations.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
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

	test('fall back to the exact outcome ID when the universe summary is unavailable', () => {
		expect(createChildUniverseTransactionIntent('zoltar', { outcomeLabel: getOutcomeLabelForIndex(undefined, 2n) })).toMatchObject({ rows: [{ label: 'Outcome', value: 'Outcome 2' }] })
	})
})

describe('REP migration transaction dialog', () => {
	installDomTestLifecycle()

	test('#1477: the migration dialog lists each outcome with its index and child universe on its own isolated line', () => {
		const children = [
			{ exists: true, forkTime: 1n, outcomeIndex: 2n, outcomeLabel: 'Y\u0435s', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 3n },
			{ exists: true, forkTime: 1n, outcomeIndex: 6n, outcomeLabel: 'No, Yes\u202E', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 7n },
		]
		const outcomeLabels = [2n, 6n].map(outcomeIndex => getMigrationOutcomeTextForIndex(children, outcomeIndex))
		const outcomes = createZoltarMigrationTransactionIntent({ amount: '5', outcomeLabels, universeId: 1n }).rows?.find(row => row.label === 'Outcomes')
		const container = document.createElement('div')
		render(h(Fragment, null, outcomes?.value), container)
		expect(Array.from(container.querySelectorAll('li bdi')).map(line => line.textContent)).toEqual(['Y\u0435s #2 · 0x3', 'No, Yes\\u{202E} #6 · 0x7'])
	})
})
