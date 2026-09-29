/// <reference types='bun-types' />

import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { useForkAuctionInteractionState } from '@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useForkAuctionInteractionState.js'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { renderHookWithProps } from '../../support/renderHook.js'

const poolAddress: Address = '0x00000000000000000000000000000000000000aa'
const caseVariantPoolAddress: Address = '0x00000000000000000000000000000000000000AA'

describe('useForkAuctionInteractionState', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	async function renderInteractionState() {
		const hook = await renderHookWithProps(useForkAuctionInteractionState, {
			accountAddress: '0x0000000000000000000000000000000000000001',
			connectedWalletDisputeStakedAttoRep: undefined,
			forkAuctionActiveAction: undefined,
			forkAuctionError: undefined,
			forkAuctionResult: undefined,
			hasStartedTruthAuction: false,
			reportingDetails: undefined,
			securityPoolAddress: poolAddress,
			startTruthAuctionSecurityPoolAddress: undefined,
		})
		cleanupRenderedComponent = hook.cleanup
		return hook
	}

	test('reconciles a migration result with equivalent pool address casing', async () => {
		const hook = await renderInteractionState()

		await act(() => {
			hook.state().beginVaultMigrationProgress()
		})
		expect(hook.state().isVaultMigrationPending).toBe(true)

		await hook.setProps({
			forkAuctionResult: {
				action: 'migrateVault',
				hash: '0x1234',
				securityPoolAddress: caseVariantPoolAddress,
				universeId: 1n,
			},
		})

		expect(hook.state().hasCompletedVaultMigration).toBe(true)
		expect(hook.state().isVaultMigrationPending).toBe(false)
	})

	test('clears pending vault migration state when a started write ends without a result or error', async () => {
		const hook = await renderInteractionState()

		await act(() => {
			hook.state().beginVaultMigrationProgress()
			hook.renderProps({ forkAuctionActiveAction: 'migrateVault' })
		})
		expect(hook.state().isVaultMigrationPending).toBe(true)

		await hook.setProps({ forkAuctionActiveAction: undefined })
		expect(hook.state().isVaultMigrationPending).toBe(false)
	})
})
