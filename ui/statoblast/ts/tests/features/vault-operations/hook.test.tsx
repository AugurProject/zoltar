import { describe, expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle, requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { waitFor, fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { appBlockWatcher } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { VaultOperationsPanel } from '@zoltar/ui-statoblast-shared/features/vault-operations/components/VaultOperationsPanel.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { useVaultOperations } from '@zoltar/ui-statoblast-shared/features/vault-operations/hooks/useVaultOperations.js'
import type { VaultOperationsDependencies } from '@zoltar/ui-statoblast-shared/features/vault-operations/hooks/dependencies.js'
import type { VaultOperationsResult } from '@zoltar/ui-statoblast-shared/protocol/vaultOperations.js'
import { createSelectedPool, createSecurityVaultDetails, createSecurityPoolVaultSummary, createOracleManagerDetails } from '../security-pools/workflow/builders.js'

const unit = 10n ** 18n
const owner = getAddress('0x0000000000000000000000000000000000000001')
const targetAddress = getAddress('0x0000000000000000000000000000000000000002')
const target = createSecurityPoolVaultSummary({ vaultAddress: targetAddress, vaultAttoRepBacking: 100n * unit, underwritingLimitAttoEth: 100n * unit, disputeStakedAttoRep: 0n })
const owned = createSecurityVaultDetails({ vaultAddress: owner, vaultAttoRepBacking: 1000n * unit, underwritingLimitAttoEth: 0n })
const pool = createSelectedPool({ statoblastSecurityMultiplierBps: 20_000n, totalUnderwritingLimitAttoEth: 100n * unit })
const confirmed: VaultOperationsResult = { hash: '0x01', depositAttoRep: 0n, stagedExecution: { operation: 'vaultOperations', operationId: 1n, success: true, errorMessage: undefined } }

function dependencies(overrides: Partial<VaultOperationsDependencies> = {}): VaultOperationsDependencies {
	return {
		loadResolved: mock(async () => false),
		claim: mock(async (_owner, _pool, action) => ({ hash: confirmed.hash, depositAttoRep: 0n, action })),
		loadOwned: mock(async () => owned),
		loadManager: mock(async () => createOracleManagerDetails({ isPriceValid: true, lastPrice: unit, minLiquidationPriceDistanceBps: 1000n })),
		loadBalance: mock(async () => 10000n * unit),
		loadTarget: mock(async () => target),
		loadCommitmentPending: mock(async () => false),
		loadStatus: mock(async () => ({ status: 'queued' })),
		quote: mock(async () => ({ managerAddress: pool.managerAddress, repToken: owned.repToken, balance: 10000n * unit, currentBacking: owned.vaultAttoRepBacking, resolved: false, validPrice: true, pendingReportId: 0n, needsReport: false, funding: undefined, requiredRep: 0n })),
		queueCost: mock(async () => 0n),
		submit: mock(async () => confirmed),
		...overrides,
	}
}

describe('vault operations lifecycle', () => {
	const { trackCleanup } = installFakeEnvironmentLifecycle({ accountAddress: owner, installActiveEnvironment: installActiveEnvironmentForTesting })
	let sequence = 0
	async function mount(deps: VaultOperationsDependencies, key = `bundle-hook-${sequence++}`, selectedPool = pool, clonePool = false) {
		let state: ReturnType<typeof useVaultOperations> | undefined
		const presented = mock(() => undefined)
		const poolChanged = mock((_totalCommitment?: bigint) => undefined)
		function Harness() {
			state = useVaultOperations(
				clonePool ? { ...selectedPool, vaults: [...selectedPool.vaults] } : selectedPool,
				{ accountAddress: owner, onTransactionRequested: () => true, onTransactionFinished: () => undefined, onTransactionPresented: presented, onTransactionSubmitted: () => undefined, refreshState: async () => undefined },
				key,
				deps,
				poolChanged,
			)
			return <div />
		}
		const rendered = await renderIntoDocument(<Harness />)
		trackCleanup(rendered.cleanup)
		return { state: () => requireHookState(state), cleanup: rendered.cleanup, key, presented, poolChanged }
	}

	test('reduces commitment without oracle funding after resolution, then unlocks REP redemption', async () => {
		let details = { ...owned, underwritingLimitAttoEth: 50n * unit, totalUnderwritingLimitAttoEth: 50n * unit, settlementCollateralAttoEth: 0n, claimableFeesAttoEth: unit }
		const deps = dependencies({
			loadResolved: async () => true,
			loadOwned: async () => details,
			loadManager: async () => createOracleManagerDetails({ isPriceValid: false, lastPrice: 0n }),
			quote: async () => ({ managerAddress: pool.managerAddress, repToken: owned.repToken, balance: 10000n * unit, currentBacking: details.vaultAttoRepBacking, resolved: true, validPrice: false, pendingReportId: 0n, needsReport: false, funding: undefined, requiredRep: 0n }),
			submit: mock(async () => {
				details = { ...details, underwritingLimitAttoEth: 0n }
				return { hash: confirmed.hash, action: 'commitment', depositAttoRep: 0n }
			}),
		})
		const current = await mount(deps, undefined, { ...pool, questionOutcome: 'yes' })
		await waitFor(() => expect(current.state().loading).toBe(false))
		expect(current.state().repClaimReason).toContain('commitment limit to 0')
		await act(() => current.state().setDraft({ commitment: '0', proposedPrice: 'invalid', timeoutMinutes: '0' }))
		await waitFor(() => expect(current.state().quote).toBeDefined())
		await act(async () => await current.state().submit())
		await waitFor(() => expect(current.state().repClaimReason).toBeUndefined())
		expect(deps.queueCost).not.toHaveBeenCalled()
		await act(async () => await current.state().redeemRep())
		expect(deps.claim).toHaveBeenCalledWith(owner, pool.securityPoolAddress, 'redeem', expect.anything())
	})
	test('can clear a persisted operational draft after the question resolves', async () => {
		let resolved = false
		const deps = dependencies({ loadResolved: async () => resolved })
		const current = await mount(deps)
		await waitFor(() => expect(current.state().loading).toBe(false))
		await act(() => current.state().setDraft({ deposit: '5', withdraw: '1' }))
		resolved = true
		await act(() => current.state().refresh())
		await waitFor(() => expect(current.state().resolved).toBe(true))
		expect(current.state().inputError).toContain('Clear other actions')
		await act(() => current.state().clearDraft())
		expect(current.state().draft.deposit).toBe('')
		expect(current.state().draft.withdraw).toBe('')
	})
	test('claims fees independently while preserving an unfinished operation draft', async () => {
		const deps = dependencies({ loadOwned: async () => ({ ...owned, claimableFeesAttoEth: unit }) })
		const current = await mount(deps)
		await waitFor(() => expect(current.state().loading).toBe(false))
		await act(() => current.state().setDraft({ deposit: '5' }))
		await act(async () => await current.state().claimFees())
		expect(deps.claim).toHaveBeenCalledWith(owner, pool.securityPoolAddress, 'fees', expect.anything())
		expect(current.state().draft.deposit).toBe('5')
	})
	test('claiming fees preserves the receipt and polling of a queued bundle', async () => {
		const queued: VaultOperationsResult = { hash: '0x02', depositAttoRep: 0n, queuedOperation: { operation: 'vaultOperations', operationId: 2n, isPendingSlot: true } }
		const deps = dependencies({ submit: async () => queued })
		const current = await mount(deps)
		await waitFor(() => expect(current.state().loading).toBe(false))
		await act(() => current.state().setDraft({ deposit: '5' }))
		await waitFor(() => expect(current.state().quote).toBeDefined())
		await act(async () => await current.state().submit())
		await act(async () => await current.state().claimFees())
		expect(current.state().result?.hash).toBe('0x02')
		expect(current.state().pending).toBe(true)
		expect(current.state().claimResult?.action).toBe('fees')
	})
	test('keeps a looked-up selection removable across tab remounts', async () => {
		const deps = dependencies()
		const first = await mount(deps)
		await waitFor(() => expect(first.state().loading).toBe(false))
		await act(() => first.state().setLookupAddress(targetAddress))
		await act(async () => await first.state().lookup())
		await act(() => first.state().toggle(target))
		await first.cleanup()
		const second = await mount(deps, first.key)
		await waitFor(() => expect(second.state().loading).toBe(false))
		expect(second.state().targets.some(value => value.vaultAddress === targetAddress)).toBe(true)
		expect(second.state().preview).toBeDefined()
		await act(() => second.state().toggle(target))
		expect(second.state().draft.liquidations).toHaveLength(0)
	})

	test('persists confirmation and clears the draft when unmounted during submission', async () => {
		const write = createDeferred<VaultOperationsResult>()
		const deps = dependencies({ submit: async () => await write.promise })
		const first = await mount(deps)
		await waitFor(() => expect(first.state().loading).toBe(false))
		await act(() => first.state().setDraft({ deposit: '5' }))
		await waitFor(() => expect(first.state().quote).toBeDefined())
		let submission: Promise<void> | undefined
		await act(() => {
			submission = first.state().submit()
		})
		first.poolChanged.mockClear()
		await first.cleanup()
		write.resolve(confirmed)
		await submission
		expect(first.poolChanged).not.toHaveBeenCalled()
		const second = await mount(deps, first.key)
		await waitFor(() => expect(second.state().loading).toBe(false))
		expect(second.state().result?.hash).toBe(confirmed.hash)
		expect(second.state().draft.deposit).toBe('')
	})

	test('reloads target details immediately after confirmation', async () => {
		let liquidated = false
		const deps = dependencies({
			loadTarget: async () => ({ ...target, underwritingLimitAttoEth: liquidated ? 0n : target.underwritingLimitAttoEth }),
			submit: async () => {
				liquidated = true
				return confirmed
			},
		})
		const current = await mount(deps, undefined, { ...pool, vaults: [target] })
		await waitFor(() => expect(current.state().loading).toBe(false))
		await act(() => current.state().setDraft({ deposit: '5' }))
		await waitFor(() => expect(current.state().quote).toBeDefined())
		await act(async () => await current.state().submit())
		await waitFor(() => expect(current.state().targets.some(value => value.vaultAddress === targetAddress && value.underwritingLimitAttoEth > 0n)).toBe(false))
		expect(current.poolChanged).toHaveBeenCalledWith()
		expect(current.poolChanged).toHaveBeenCalledWith(owned.totalUnderwritingLimitAttoEth)
	})

	test('refreshes vault, targets and pending commitment without waiting for a slow oracle read', async () => {
		const oracle = createDeferred<ReturnType<typeof createOracleManagerDetails>>()
		const current = await mount(dependencies({ loadManager: async () => await oracle.promise, loadCommitmentPending: async () => true }), undefined, { ...pool, vaults: [target] })
		await waitFor(() => expect(current.state().owned).toEqual(owned))
		await waitFor(() => expect(current.state().targets).toContainEqual(target))
		await waitFor(() => expect(current.state().commitmentPending).toBe(true))
		expect(current.state().manager).toBeUndefined()
		oracle.resolve(createOracleManagerDetails())
		await waitFor(() => expect(current.state().loading).toBe(false))
	})

	test('a new block does not cancel an in-flight vault refresh', async () => {
		const refreshed = createDeferred<typeof owned>()
		let reads = 0
		const current = await mount(dependencies({ loadOwned: async () => (++reads === 1 ? await refreshed.promise : await new Promise<typeof owned>(() => undefined)) }))
		await waitFor(() => expect(reads).toBe(1))
		await act(() => {
			appBlockWatcher.reportBlock(9200n)
			appBlockWatcher.reportBlock(9201n)
		})
		refreshed.resolve(owned)
		await waitFor(() => expect(current.state().owned).toEqual(owned))
	})

	test('does not replay or poll terminal queued results after remount, and can dismiss them', async () => {
		const queued: VaultOperationsResult = { hash: '0x02', depositAttoRep: 0n, queuedOperation: { operation: 'vaultOperations', operationId: 2n, isPendingSlot: true } }
		const loadStatus = mock(async () => ({ status: 'executed' as const }))
		const deps = dependencies({ submit: async () => queued, loadStatus })
		const first = await mount(deps)
		await waitFor(() => expect(first.state().loading).toBe(false))
		await act(() => first.state().setDraft({ deposit: '5' }))
		await waitFor(() => expect(first.state().quote).toBeDefined())
		await act(async () => await first.state().submit())
		await waitFor(() => expect(first.state().status?.status).toBe('executed'))
		expect(first.presented).toHaveBeenCalledTimes(2)
		await first.cleanup()
		const second = await mount(deps, first.key)
		await waitFor(() => expect(second.state().loading).toBe(false))
		expect(second.presented).not.toHaveBeenCalled()
		expect(loadStatus).toHaveBeenCalledTimes(1)
		await act(() => second.state().dismissResult())
		expect(second.state().result).toBeUndefined()
	})

	test('keeps the last quote during block revalidation', async () => {
		const current = await mount(dependencies())
		await waitFor(() => expect(current.state().loading).toBe(false))
		await act(() => current.state().setDraft({ deposit: '5' }))
		await waitFor(() => expect(current.state().quote).toBeDefined())
		const previous = current.state().quote
		await act(() => {
			appBlockWatcher.reportBlock(9000n)
			appBlockWatcher.reportBlock(9001n)
		})
		expect(current.state().quote).toBe(previous)
	})

	async function mountPanel(deps: VaultOperationsDependencies, selectedTarget = target) {
		const rendered = await renderIntoDocument(
			<VaultOperationsPanel
				pool={{ ...pool, vaults: [selectedTarget] }}
				parameters={{ accountAddress: owner, onTransactionRequested: () => true, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, onTransactionSubmitted: () => undefined, refreshState: async () => undefined }}
				contextKey={`panel-${sequence++}`}
				networkReady
				onViewStagedOperations={() => undefined}
				dependencies={deps}
			/>,
		)
		trackCleanup(rendered.cleanup)
		return rendered
	}

	test('panel presents confirmation in the submission area', async () => {
		const rendered = await mountPanel(dependencies())
		await waitFor(() => expect(rendered.container.textContent).toContain('1k REP'))
		const deposit = within(rendered.container).getByLabelText('Deposit REP (optional)')
		await act(() => fireEvent.input(deposit, { target: { value: '5' } }))
		const review = within(rendered.container).getByRole<HTMLButtonElement>('button', { name: 'Review vault operations' })
		await waitFor(() => expect(review.disabled).toBe(false))
		await act(() => fireEvent.click(review))
		await waitFor(() => expect(rendered.container.textContent).toContain('Vault operations executed'))
		const confirmation = within(rendered.container).getByText('Vault operations executed')
		expect(confirmation.closest('.vault-operations-preview')).not.toBeNull()
	})
	test('panel disables a near target with the existing liquidation distance reason', async () => {
		const near = { ...target, vaultAttoRepBacking: 190n * unit }
		const rendered = await mountPanel(dependencies({ loadTarget: async () => near }), near)
		await waitFor(() => expect(rendered.container.textContent).toContain('10%'))
		expect(rendered.container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true)
		expect(rendered.container.textContent).toContain('REP backing')
	})

	test('panel can remove a selected target whose commitment disappears', async () => {
		let gone = false
		const rendered = await mountPanel(dependencies({ loadTarget: async () => ({ ...target, underwritingLimitAttoEth: gone ? 0n : target.underwritingLimitAttoEth }) }))
		await waitFor(() => expect(rendered.container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(false))
		const checkbox = rendered.container.querySelector<HTMLInputElement>('input[type="checkbox"]')
		if (checkbox === null) throw new Error('Missing target checkbox')
		await act(() => fireEvent.click(checkbox))
		expect(checkbox.checked).toBe(true)
		gone = true
		await act(() => {
			appBlockWatcher.reportBlock(9100n)
			appBlockWatcher.reportBlock(9101n)
		})
		await waitFor(() => expect(rendered.container.textContent).toContain('Target vault is unavailable'))
		expect(checkbox.disabled).toBe(false)
		await act(() => fireEvent.click(checkbox))
		await waitFor(() => expect(within(rendered.container).queryByText('Commitment to take over')).toBeNull())
	})
	test('pool render copies do not restart or starve vault reads', async () => {
		const loadOwned = mock(async () => owned)
		const current = await mount(dependencies({ loadOwned }), undefined, pool, true)
		await waitFor(() => expect(current.state().loading).toBe(false))
		await act(async () => await new Promise(resolve => setTimeout(resolve, 150)))
		expect(loadOwned.mock.calls.length).toBeLessThanOrEqual(2)
	})
})
