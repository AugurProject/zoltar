/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/shared/ethereum'
import { useForkAuctionInteractionState } from '../../../features/truth-auctions/hooks/useForkAuctionInteractionState.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

type InteractionProps = Parameters<typeof useForkAuctionInteractionState>[0]
type InteractionState = ReturnType<typeof useForkAuctionInteractionState>

const poolAddress: Address = '0x00000000000000000000000000000000000000aa'
const caseVariantPoolAddress: Address = '0x00000000000000000000000000000000000000AA'

describe('useForkAuctionInteractionState', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restoreDomEnvironment: (() => void) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('reconciles a migration result with equivalent pool address casing', async () => {
		let hookState: InteractionState | undefined
		let setHarnessProps: ((update: (current: InteractionProps) => InteractionProps) => void) | undefined
		const initialProps: InteractionProps = {
			accountAddress: '0x0000000000000000000000000000000000000001',
			connectedWalletDisputeStakedAttoRep: undefined,
			forkAuctionActiveAction: undefined,
			forkAuctionError: undefined,
			forkAuctionResult: undefined,
			hasStartedTruthAuction: false,
			reportingDetails: undefined,
			securityPoolAddress: poolAddress,
			startTruthAuctionSecurityPoolAddress: undefined,
		}

		function Harness() {
			const [props, setProps] = useState<InteractionProps>(initialProps)
			setHarnessProps = update => setProps(update)
			hookState = useForkAuctionInteractionState(props)
			return <div />
		}

		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup
		if (hookState === undefined || setHarnessProps === undefined) throw new Error('Interaction harness did not render')

		await act(() => {
			hookState?.beginVaultMigrationProgress()
		})
		expect(hookState.isVaultMigrationPending).toBe(true)

		await act(() => {
			setHarnessProps?.(current => ({
				...current,
				forkAuctionResult: {
					action: 'migrateVault',
					hash: '0x1234',
					securityPoolAddress: caseVariantPoolAddress,
					universeId: 1n,
				},
			}))
		})

		expect(hookState.hasCompletedVaultMigration).toBe(true)
		expect(hookState.isVaultMigrationPending).toBe(false)
	})

	test('clears pending vault migration state when a started write ends without a result or error', async () => {
		let hookState: InteractionState | undefined
		let setHarnessProps: ((update: (current: InteractionProps) => InteractionProps) => void) | undefined
		const initialProps: InteractionProps = {
			accountAddress: '0x0000000000000000000000000000000000000001',
			connectedWalletDisputeStakedAttoRep: undefined,
			forkAuctionActiveAction: undefined,
			forkAuctionError: undefined,
			forkAuctionResult: undefined,
			hasStartedTruthAuction: false,
			reportingDetails: undefined,
			securityPoolAddress: poolAddress,
			startTruthAuctionSecurityPoolAddress: undefined,
		}

		function Harness() {
			const [props, setProps] = useState<InteractionProps>(initialProps)
			setHarnessProps = update => setProps(update)
			hookState = useForkAuctionInteractionState(props)
			return <div />
		}

		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup
		if (hookState === undefined || setHarnessProps === undefined) throw new Error('Interaction harness did not render')

		await act(() => {
			hookState?.beginVaultMigrationProgress()
			setHarnessProps?.(current => ({ ...current, forkAuctionActiveAction: 'migrateVault' }))
		})
		expect(hookState.isVaultMigrationPending).toBe(true)

		await act(() => {
			setHarnessProps?.(current => ({ ...current, forkAuctionActiveAction: undefined }))
		})
		expect(hookState.isVaultMigrationPending).toBe(false)
	})
})
