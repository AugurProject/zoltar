/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ChildUniverseDetails } from '../../../features/universes/components/ChildUniverseDetails.js'
import { installActiveEnvironmentForTesting } from '../../../lib/activeEnvironment.js'
import { createInjectedBackend } from '../../../lib/chainBackend.js'
import type { ZoltarChildUniverseSummary } from '../../../types/contracts.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { within } from '../../testUtils/queries.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'

const TOKEN_ADDRESS = '0x00000000000000000000000000000000000000a1'

function createChild(overrides: Partial<ZoltarChildUniverseSummary> = {}): ZoltarChildUniverseSummary {
	return {
		exists: true,
		forkTime: 0n,
		outcomeIndex: 1n,
		outcomeLabel: 'Yes',
		parentUniverseId: 0n,
		reputationToken: TOKEN_ADDRESS,
		universeId: 10n,
		...overrides,
	}
}

describe('ChildUniverseDetails wallet asset control', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restoreActiveEnvironment: (() => void) | undefined
	let restoreDomEnvironment: (() => void) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		Reflect.set(domEnvironment.window, 'ethereum', {
			request: async () => true,
		})
		restoreActiveEnvironment = installActiveEnvironmentForTesting(createInjectedBackend())
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreActiveEnvironment?.()
		restoreActiveEnvironment = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('adds the control only for deployed child-universe REP tokens', async () => {
		const deployed = await renderIntoDocument(<ChildUniverseDetails accountAddress={TOKEN_ADDRESS} child={createChild()} isSupportedChain />)
		cleanupRenderedComponent = deployed.cleanup
		expect(within(document.body).getByRole('button', { name: 'Add Universe 0xa REP to wallet' })).not.toBeNull()

		await cleanupRenderedComponent()
		cleanupRenderedComponent = undefined
		const undeployed = await renderIntoDocument(<ChildUniverseDetails accountAddress={TOKEN_ADDRESS} child={createChild({ exists: false, reputationToken: zeroAddress })} isSupportedChain />)
		cleanupRenderedComponent = undeployed.cleanup
		expect(within(document.body).queryByRole('button', { name: /Add .* REP to wallet/ })).toBeNull()
	})
})
