import { describe, expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { VaultOperationsInput } from '@zoltar/statoblast-shared/statoblast/vaultOperations'
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
import * as liquidationCopy from '@zoltar/ui-statoblast-shared/copy/liquidation.js'
import * as vaultOperationsCopy from '@zoltar/ui-statoblast-shared/copy/vaultOperations.js'
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
		fetchPrice: mock(async () => 2n * unit),
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
		loadPrerequisites: mock(async () => ({ wrapAttoEth: undefined, approvals: [] })),
		approve: mock(async () => ({ hash: '0x03' as const })),
		wrap: mock(async () => ({ hash: '0x04' as const })),
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
	test('translates a pool revert reason like the liquidation dialog does', async () => {
		const current = await mount(
			dependencies({
				quote: async () => {
					throw new Error('Target safe')
				},
			}),
		)
		await waitFor(() => expect(current.state().loading).toBe(false))
		await act(() => current.state().setDraft({ deposit: '1' }))
		await waitFor(() => expect(current.state().quoteError).toBe(liquidationCopy.targetNotLiquidatableError))
	})
	test('closes an unmapped pool revert reason as a sentence', async () => {
		const current = await mount(
			dependencies({
				quote: async () => {
					throw new Error('Pool is paused')
				},
			}),
		)
		await waitFor(() => expect(current.state().loading).toBe(false))
		await act(() => current.state().setDraft({ deposit: '1' }))
		await waitFor(() => expect(current.state().quoteError).toBe('Pool is paused.'))
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
	test('rechecks fees before claiming even when the vault has a commitment', async () => {
		let fees = unit
		const deps = dependencies({ loadOwned: async () => ({ ...owned, underwritingLimitAttoEth: unit, claimableFeesAttoEth: fees }) })
		const current = await mount(deps)
		await waitFor(() => expect(current.state().loading).toBe(false))
		expect(current.state().feeClaimReason).toBeUndefined()
		fees = 0n
		await act(async () => await current.state().claimFees())
		expect(deps.claim).not.toHaveBeenCalled()
		expect(current.state().claimError).toContain('No fees are available to claim')
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

	test.each([
		['a translated pool reason', 'Target safe', liquidationCopy.targetNotLiquidatableError],
		['no detail when the pool gave no reason', undefined, undefined],
	] as const)('presents a failed queued result with a title and %s', async (_scenario, errorMessage, detail) => {
		const queued: VaultOperationsResult = { hash: '0x02', depositAttoRep: 0n, queuedOperation: { operation: 'vaultOperations', operationId: 2n, isPendingSlot: true } }
		const loadStatus = mock(async () => ({ status: 'failed' as const, execution: { operation: 'vaultOperations' as const, operationId: 2n, success: false, errorMessage } }))
		const current = await mount(dependencies({ submit: async () => queued, loadStatus }))
		await waitFor(() => expect(current.state().loading).toBe(false))
		await act(() => current.state().setDraft({ deposit: '5' }))
		await waitFor(() => expect(current.state().quote).toBeDefined())
		await act(async () => await current.state().submit())
		await waitFor(() => expect(current.state().status?.status).toBe('failed'))
		expect(current.presented).toHaveBeenLastCalledWith(expect.objectContaining({ title: vaultOperationsCopy.failedTitle, detail, tone: 'error' }))
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

	test('does not report an unchanged pool commitment on every block', async () => {
		const loadOwned = mock(async () => owned)
		const current = await mount(dependencies({ loadOwned }))
		await waitFor(() => expect(current.state().loading).toBe(false))
		expect(current.poolChanged).toHaveBeenCalledWith(owned.totalUnderwritingLimitAttoEth)
		current.poolChanged.mockClear()
		const reads = loadOwned.mock.calls.length
		await act(() => {
			appBlockWatcher.reportBlock(9300n)
			appBlockWatcher.reportBlock(9301n)
		})
		await waitFor(() => expect(loadOwned.mock.calls.length).toBeGreaterThan(reads))
		await act(async () => await new Promise(resolve => setTimeout(resolve, 0)))
		expect(current.poolChanged).not.toHaveBeenCalled()
	})

	const staleManager = async () => createOracleManagerDetails({ isPriceValid: false, lastPrice: unit, minLiquidationPriceDistanceBps: 1000n })
	const staleQuote = (price: bigint) => {
		if (price <= 0n) throw new Error(vaultOperationsCopy.initialPriceNeeded)
		return { managerAddress: pool.managerAddress, repToken: owned.repToken, balance: 10000n * unit, currentBacking: owned.vaultAttoRepBacking, resolved: false, validPrice: false, pendingReportId: 0n, needsReport: true, funding: undefined, requiredRep: 0n }
	}

	test('a blank initial report price is never replaced by the stale cached price', async () => {
		const quote = mock(async (_pool: Address, _owner: Address, _input: VaultOperationsInput, price: bigint) => staleQuote(price))
		const current = await mount(dependencies({ loadManager: staleManager, quote }))
		await waitFor(() => expect(current.state().loading).toBe(false))
		await act(() => current.state().setDraft({ commitment: '1' }))
		await waitFor(() => expect(current.state().quoteError).toBe(vaultOperationsCopy.initialPriceNeeded))
		expect(quote.mock.calls.every(call => call[3] === 0n)).toBe(true)
		// The preview still estimates with the cached price.
		expect(current.state().preview).toBeDefined()
		await act(() => current.state().setDraft({ proposedPrice: '2' }))
		await waitFor(() => expect(current.state().quote).toBeDefined())
		expect(quote).toHaveBeenLastCalledWith(pool.securityPoolAddress, owner, expect.anything(), 2n * unit)
	})

	test('checks a commitment increase at the proposed price while the oracle price is stale', async () => {
		const current = await mount(dependencies({ loadManager: staleManager, quote: async (_pool, _owner, _input, price) => staleQuote(price) }))
		await waitFor(() => expect(current.state().loading).toBe(false))
		await act(() => current.state().setDraft({ commitment: '1000', proposedPrice: '1' }))
		expect(current.state().inputError).toBe('Deposit more REP before increasing this commitment limit.')
		await act(() => current.state().setDraft({ commitment: '100' }))
		expect(current.state().inputError).toBeUndefined()
	})

	test('checks withdrawal coverage and offers an estimated maximum at the proposed price while the oracle price is stale', async () => {
		const committed = { ...owned, vaultAttoRepBacking: 100n * unit, underwritingLimitAttoEth: 50n * unit, totalUnderwritingLimitAttoEth: 50n * unit }
		const current = await mount(dependencies({ loadOwned: async () => committed, loadManager: staleManager, quote: async (_pool, _owner, _input, price) => staleQuote(price) }))
		await waitFor(() => expect(current.state().loading).toBe(false))
		expect(current.state().withdrawMaximum).toBeUndefined()
		await act(() => current.state().setDraft({ withdraw: '60', proposedPrice: '1' }))
		expect(current.state().inputError).toBe(vaultOperationsCopy.withdrawCoverage)
		expect(current.state().withdrawMaximum).toBeDefined()
	})

	async function mountPanel(deps: VaultOperationsDependencies, selectedTarget = target, onViewStagedOperations: (operationId: bigint) => void = () => undefined) {
		const rendered = await renderIntoDocument(
			<VaultOperationsPanel
				pool={{ ...pool, vaults: [selectedTarget] }}
				parameters={{ accountAddress: owner, onTransactionRequested: () => true, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, onTransactionSubmitted: () => undefined, refreshState: async () => undefined }}
				contextKey={`panel-${sequence++}`}
				networkReady
				onViewStagedOperations={onViewStagedOperations}
				dependencies={deps}
			/>,
		)
		trackCleanup(rendered.cleanup)
		return rendered
	}

	test('keeps target address copy and explorer actions separate from liquidation selection', async () => {
		const rendered = await mountPanel(dependencies())
		const queries = within(rendered.container)
		await waitFor(() => expect(rendered.container.textContent).toMatch(/Current REP backing1\s000\.00\sREP/))
		const checkbox = queries.getByRole<HTMLInputElement>('checkbox')
		const copy = queries.getByRole('button', { name: `Copy address ${targetAddress}` })
		const targetChoice = copy.closest('.vault-operations-target-choice')
		if (targetChoice === null) throw new Error('Expected a liquidation target')
		const explorer = within(targetChoice).getByRole('link')
		expect(copy.closest('label') === null).toBe(true)
		expect(explorer.getAttribute('href')).toBe(`https://etherscan.io/address/${targetAddress}`)
		expect(explorer.closest('label') === null).toBe(true)
		expect(checkbox.checked).toBe(false)
		await act(() => fireEvent.click(copy))
		expect(checkbox.checked).toBe(false)
		await act(() => fireEvent.click(checkbox))
		expect(checkbox.checked).toBe(true)
	})

	test.each([0n, unit])('panel only enables fee claiming for positive fees (%s)', async fees => {
		const rendered = await mountPanel(dependencies({ loadOwned: async () => ({ ...owned, underwritingLimitAttoEth: unit, claimableFeesAttoEth: fees }) }))
		await waitFor(() => expect(rendered.container.textContent).not.toContain(vaultOperationsCopy.loading))
		const claim = within(rendered.container).getByRole<HTMLButtonElement>('button', { name: 'Claim fees' })
		await waitFor(() => expect(claim.disabled).toBe(fees === 0n))
		if (fees === 0n) expect(rendered.container.textContent).toContain('No fees are available to claim')
	})
	test('panel explains an unavailable deposit Max once the wallet balance has loaded', async () => {
		const rendered = await mountPanel(dependencies({ loadBalance: mock(async () => 0n) }))
		const queries = within(rendered.container)
		await waitFor(() => expect(rendered.container.textContent).toContain('No wallet REP is left to deposit after the oracle REP funding.'))
		expect(rendered.container.textContent).not.toContain('Checking vault and oracle…')
		const deposit = queries.getByLabelText('REP deposit amount (optional)')
		const max = deposit.closest('.amount-field')?.querySelector('.field-inline-action')
		if (!(max instanceof HTMLButtonElement)) throw new Error('Expected the deposit Max button')
		expect(max.disabled).toBe(true)
	})

	test('panel states why target lookup is disabled under the whole lookup row', async () => {
		const rendered = await mountPanel(dependencies())
		const queries = within(rendered.container)
		await waitFor(() => expect(rendered.container.textContent).toMatch(/Current REP backing1\s000\.00\sREP/))
		const input = queries.getByLabelText('Find target by address')
		const add = queries.getByRole<HTMLButtonElement>('button', { name: 'Add target' })
		const reasonId = add.getAttribute('aria-describedby')
		expect(add.disabled).toBe(true)
		expect(reasonId).not.toBeNull()
		expect(document.getElementById(reasonId ?? '')?.textContent).toBe('Enter a vault address.')
		expect(input.getAttribute('aria-describedby')).toContain(reasonId ?? '')
		// The field hint under the whole row is the only place the reason appears, never again beneath the button.
		expect(rendered.container.textContent?.split('Enter a vault address.').length).toBe(2)
	})

	test('panel previews entered amounts in standard notation', async () => {
		const rendered = await mountPanel(dependencies())
		const queries = within(rendered.container)
		await waitFor(() => expect(rendered.container.textContent).not.toContain(vaultOperationsCopy.loading))
		await act(() => fireEvent.input(queries.getByLabelText('REP deposit amount (optional)'), { target: { value: '1234.5' } }))
		await waitFor(() => expect(rendered.container.querySelector('.vault-operations-summary')?.textContent).toMatch(/Deposit1\s234\.50\sREP/))
	})

	test('panel presents confirmation in the submission area', async () => {
		const rendered = await mountPanel(dependencies())
		await waitFor(() => expect(rendered.container.textContent).not.toContain(vaultOperationsCopy.loading))
		const deposit = within(rendered.container).getByLabelText('REP deposit amount (optional)')
		await act(() => fireEvent.input(deposit, { target: { value: '5' } }))
		const review = within(rendered.container).getByRole<HTMLButtonElement>('button', { name: 'Review vault operations' })
		await waitFor(() => expect(review.disabled).toBe(false))
		await act(() => fireEvent.click(review))
		await waitFor(() => expect(rendered.container.textContent).toContain('Vault operations executed'))
		const confirmation = within(rendered.container).getByText('Vault operations executed')
		expect(confirmation.closest('.vault-operations-preview')).not.toBeNull()
	})
	test('opens the exact staged operation returned by the bundle', async () => {
		const viewStaged = mock((_operationId: bigint) => undefined)
		const queued: VaultOperationsResult = { hash: '0x02', depositAttoRep: 5n * unit, queuedOperation: { operation: 'vaultOperations', operationId: 42n, isPendingSlot: true } }
		const rendered = await mountPanel(dependencies({ submit: async () => queued }), target, viewStaged)
		const queries = within(rendered.container)
		await act(() => fireEvent.input(queries.getByLabelText('REP deposit amount (optional)'), { target: { value: '5' } }))
		const review = queries.getByRole<HTMLButtonElement>('button', { name: 'Review vault operations' })
		await waitFor(() => expect(review.disabled).toBe(false))
		await act(() => fireEvent.click(review))
		await waitFor(() => expect(queries.queryByRole('button', { name: 'View staged operations' })).not.toBeNull())
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'View staged operations' })))
		expect(viewStaged).toHaveBeenCalledWith(42n)
	})

	test('panel offers the REP deposit approval inline and keeps Review disabled until it is approved', async () => {
		let approved = 0n
		const approve = mock(async (_owner: Address, _token: Address, _spender: Address, amount: bigint) => {
			approved = amount
			return { hash: '0x03' as const }
		})
		const submit = mock(async () => confirmed)
		const loadPrerequisites = mock(async (_pool: Address, _owner: Address, input: VaultOperationsInput) => ({
			wrapAttoEth: undefined,
			approvals: [{ kind: 'deposit' as const, tokenAddress: owned.repToken, spender: pool.securityPoolAddress, requiredAmount: input.depositAttoRep, recommendedAmount: undefined, approvedAmount: approved }],
		}))
		const rendered = await mountPanel(dependencies({ approve, submit, loadPrerequisites }))
		const queries = within(rendered.container)
		await act(() => fireEvent.input(queries.getByLabelText('REP deposit amount (optional)'), { target: { value: '5' } }))
		await waitFor(() => expect(rendered.container.textContent).toContain(vaultOperationsCopy.approvalRequired.deposit))
		expect(queries.getByRole<HTMLButtonElement>('button', { name: 'Review vault operations' }).disabled).toBe(true)
		const approveButton = await waitFor(() => {
			const button = queries.getByRole<HTMLButtonElement>('button', { name: /^Approve .*REP$/ })
			expect(button.disabled).toBe(false)
			return button
		})
		await act(() => fireEvent.click(approveButton))
		await waitFor(() => expect(queries.getByRole<HTMLButtonElement>('button', { name: 'Review vault operations' }).disabled).toBe(false))
		expect(approve).toHaveBeenCalledTimes(1)
		expect(approve).toHaveBeenCalledWith(owner, owned.repToken, pool.securityPoolAddress, 5n * unit, expect.anything())
		expect(submit).not.toHaveBeenCalled()
		expect(rendered.container.textContent).toContain('REP approved ✓')
	})

	test('panel offers the oracle report WETH wrap as its own transaction before Review', async () => {
		let wrapped = false
		const wrap = mock(async () => {
			wrapped = true
			return { hash: '0x04' as const }
		})
		const approve = mock(async () => ({ hash: '0x03' as const }))
		const loadPrerequisites = mock(async () => ({
			wrapAttoEth: wrapped ? 0n : unit / 100n,
			approvals: [
				{ kind: 'reportWeth' as const, tokenAddress: targetAddress, spender: pool.managerAddress, requiredAmount: unit / 100n, recommendedAmount: unit / 50n, approvedAmount: unit },
				{ kind: 'reportRep' as const, tokenAddress: owned.repToken, spender: pool.managerAddress, requiredAmount: unit, recommendedAmount: 2n * unit, approvedAmount: 2n * unit },
			],
		}))
		const rendered = await mountPanel(dependencies({ loadManager: staleManager, quote: async (_pool, _owner, _input, price) => staleQuote(price), wrap, approve, loadPrerequisites }))
		const queries = within(rendered.container)
		await waitFor(() => expect(rendered.container.textContent).not.toContain(vaultOperationsCopy.loading))
		await act(() => fireEvent.input(queries.getByLabelText(/^Commitment limit/), { target: { value: '1' } }))
		await act(() => fireEvent.input(queries.getByLabelText('Initial report price'), { target: { value: '1' } }))
		const wrapButton = () => queries.getByRole<HTMLButtonElement>('button', { name: /^Wrap ETH into WETH/ })
		await waitFor(() => expect(wrapButton().disabled).toBe(false))
		expect(rendered.container.textContent).toContain(vaultOperationsCopy.wrapRequired)
		expect(queries.getByRole<HTMLButtonElement>('button', { name: 'Review vault operations' }).disabled).toBe(true)
		await act(() => fireEvent.click(wrapButton()))
		await waitFor(() => expect(queries.getByRole<HTMLButtonElement>('button', { name: 'Review vault operations' }).disabled).toBe(false))
		expect(wrap).toHaveBeenCalledTimes(1)
		expect(wrap).toHaveBeenCalledWith(owner, unit / 100n, expect.anything())
		expect(approve).not.toHaveBeenCalled()
		expect(wrapButton().disabled).toBe(true)
	})

	test('panel warns when the typed initial report price looks inverted', async () => {
		const rendered = await mountPanel(dependencies({ loadManager: async () => createOracleManagerDetails({ isPriceValid: false, lastPrice: 300n * unit, minLiquidationPriceDistanceBps: 1000n }), quote: async (_pool, _owner, _input, price) => staleQuote(price) }))
		const queries = within(rendered.container)
		await waitFor(() => expect(rendered.container.textContent).not.toContain(vaultOperationsCopy.loading))
		await act(() => fireEvent.input(queries.getByLabelText('Initial report price'), { target: { value: '0.0033' } }))
		expect(rendered.container.textContent).toContain('This looks inverted (ETH per REP).')
	})

	test('review uses only the button to indicate its pending state', async () => {
		const pending = createDeferred<VaultOperationsResult>()
		const rendered = await mountPanel(dependencies({ submit: () => pending.promise }))
		const queries = within(rendered.container)
		await act(() => fireEvent.input(queries.getByLabelText('REP deposit amount (optional)'), { target: { value: '5' } }))
		const review = queries.getByRole<HTMLButtonElement>('button', { name: 'Review vault operations' })
		await waitFor(() => expect(review.disabled).toBe(false))
		await act(() => fireEvent.click(review))
		await waitFor(() => expect(queries.queryByRole('button', { name: 'Reviewing vault operations…' })).not.toBeNull())
		expect(rendered.container.textContent).not.toContain('Submitting transaction')
		expect(rendered.container.textContent).not.toContain('Submitting vault operations')
		await act(() => pending.resolve(confirmed))
	})
	test.each([10n * unit, unit / 8n])('panel describes the pool minimum below the REP deposit (%s)', async minimum => {
		const rendered = await mountPanel(dependencies({ loadOwned: async () => ({ ...owned, minimumVaultRepDepositAttoRep: minimum }) }))
		const expected = minimum === 10n * unit ? 'Minimum vault backing: 10 REP' : 'Minimum vault backing: 0.125 REP'
		await waitFor(() => expect(rendered.container.textContent).toContain(expected))
		const deposit = within(rendered.container).getByLabelText('REP deposit amount (optional)')
		const hint = within(rendered.container).getByText(expected)
		expect(deposit.closest('.amount-field')?.contains(hint)).toBe(true)
		expect(deposit.getAttribute('aria-describedby')?.split(' ')).toContain(hint.id)
	})
	test('panel fetches a Uniswap price into the initial report field', async () => {
		const deps = dependencies({
			loadManager: async () => createOracleManagerDetails({ isPriceValid: false, lastPrice: unit }),
			quote: async () => ({ managerAddress: pool.managerAddress, repToken: owned.repToken, balance: 10000n * unit, currentBacking: owned.vaultAttoRepBacking, resolved: false, validPrice: false, pendingReportId: 0n, needsReport: true, funding: undefined, requiredRep: 0n }),
		})
		const rendered = await mountPanel(deps)
		const queries = within(rendered.container)
		await waitFor(() => expect(queries.queryByRole('button', { name: 'Fetch from Uniswap' })).not.toBeNull())
		const fetch = queries.getByRole<HTMLButtonElement>('button', { name: 'Fetch from Uniswap' })
		await waitFor(() => expect(fetch.disabled).toBe(false))
		await act(() => fireEvent.click(fetch))
		await waitFor(() => expect(queries.getByLabelText<HTMLInputElement>('Initial report price').value).toBe('2'))
		expect(deps.fetchPrice).toHaveBeenCalledWith(pool.managerAddress)
	})
	test('price fetch failure preserves manual input and allows retry', async () => {
		const pending = createDeferred<bigint>()
		const current = await mount(dependencies({ fetchPrice: () => pending.promise }))
		await waitFor(() => expect(current.state().loading).toBe(false))
		await act(() => current.state().setDraft({ proposedPrice: '3' }))
		let fetching: Promise<void> | undefined
		await act(() => {
			fetching = current.state().fetchPrice()
		})
		await act(async () => {
			pending.reject(new Error('Unavailable'))
			await fetching
		})
		expect(current.state().draft.proposedPrice).toBe('3')
		expect(current.state().priceFetchError).toContain('Try again or enter a price')
		expect(current.state().fetchingPrice).toBe(false)
	})
	test('a delayed price does not overwrite manual edits', async () => {
		const pending = createDeferred<bigint>()
		const current = await mount(dependencies({ fetchPrice: () => pending.promise }))
		await waitFor(() => expect(current.state().loading).toBe(false))
		let fetching: Promise<void> | undefined
		await act(() => {
			fetching = current.state().fetchPrice()
		})
		await act(() => current.state().setDraft({ proposedPrice: '3' }))
		await act(async () => {
			pending.resolve(2n * unit)
			await fetching
		})
		expect(current.state().draft.proposedPrice).toBe('3')
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
		await waitFor(() => expect(rendered.container.textContent).toContain('This vault has no commitment to liquidate'))
		expect(checkbox.disabled).toBe(false)
		await act(() => fireEvent.click(checkbox))
		await waitFor(() => expect(within(rendered.container).queryByText('Commitment to transfer')).toBeNull())
	})
	test('pool render copies do not restart or starve vault reads', async () => {
		const loadOwned = mock(async () => owned)
		const current = await mount(dependencies({ loadOwned }), undefined, pool, true)
		await waitFor(() => expect(current.state().loading).toBe(false))
		await act(async () => await new Promise(resolve => setTimeout(resolve, 150)))
		expect(loadOwned.mock.calls.length).toBeLessThanOrEqual(2)
	})
})
