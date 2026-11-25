import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { SecurityPoolTakeover } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolTakeover.js'
import { changedSinceReview } from '@zoltar/ui-statoblast-shared/copy/app.js'
import type { SecurityPoolTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPool.js'
import { loadSecurityPoolCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { useSecurityPoolFixture, unit } from '../../../../../../solidity/ts/tests/statoblast/securityPoolFixture'
import { writeContractAndWait } from '../../../../../../solidity/ts/testSupport/simulator/utils/clients'
import { getRepTokenAddress } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { ReputationToken_ReputationToken as token } from '../../../../../../solidity/ts/types/contractArtifact'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
describe('manual takeover against native security pool contracts', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	for (const scenario of ['success', 'changed-price', 'rejected-bounds'] as const)
		test(`manual takeover applies pledged takeover rewards atomically through ${scenario}`, async () => {
			await fixture.prepare()
			await fixture.mint(200n * unit)
			const owner = fixture.owner()
			const keeper = fixture.other()
			await writeContractAndWait(owner, () => owner.writeContract({ abi: token.abi, address: getRepTokenAddress(fixture.base.genesisUniverse), functionName: 'transfer', args: [keeper.account.address, 1000n * unit] }))
			await fixture.deposit(1000n * unit, keeper)
			await fixture.refreshPrice(fixture.base.questionId, 3n * unit)
			const distressed = await loadSecurityPoolCapitalSnapshot({ client: keeper, owner: owner.account.address, securityPool: fixture.securityPool })
			const initialSource = distressed.positions[0]
			if (initialSource === undefined) throw new Error('Missing distressed position')
			expect(initialSource.liquidationStarted).toBeGreaterThan(0n)
			// Let the triggering quote expire without renewal while the auction reaches full terms.
			await fixture.base.mockWindow.advanceTime(3601n)
			const snapshot = { ...(await loadSecurityPoolCapitalSnapshot({ client: keeper, owner: keeper.account.address, securityPool: fixture.securityPool })), collateral: { symbol: 'WETH', decimals: 18 } }
			const original = await loadSecurityPoolCapitalSnapshot({ client: keeper, owner: owner.account.address, securityPool: fixture.securityPool })
			const source = original.positions[0]
			if (source === undefined) throw new Error('Missing distressed position')
			expect(source.liquidationStarted).toBe(initialSource.liquidationStarted)
			expect(snapshot.timestamp - source.liquidationStarted).toBeGreaterThanOrEqual(3600n)
			expect(snapshot.priceValid).toBe(false)
			expect(snapshot.timestamp).toBeGreaterThanOrEqual(snapshot.priceValidUntil)
			const backend = { ...createFakeBackend({ accountAddress: keeper.account.address }), createReadClient: () => keeper }
			installActiveEnvironmentForTesting(backend)
			let submitted = false
			let failure: unknown
			const actions = {
				ownerReason: undefined,
				scope: [],
				busy: undefined,
				runSecurityPoolAction: async (_action: string, _label: string, build: () => SecurityPoolTransaction | Promise<SecurityPoolTransaction>) => {
					try {
						const request = await build()
						if (scenario === 'changed-price') await fixture.refreshPrice(fixture.base.questionId, 4n * unit)
						await request.validateBeforeSubmit?.()
						await writeContractAndWait(keeper, () => keeper.sendTransaction({ ...request, gas: 8_000_000n }))
						submitted = true
					} catch (error) {
						failure = error
					}
				},
			}
			const view = await renderIntoDocument(<SecurityPoolTakeover model={{ snapshot }} actions={actions} />)
			lifecycle.trackRendered(view)
			const fields = view.container.querySelectorAll('input')
			for (const [index, value] of [source.id.toString(), '200', '1000', scenario === 'rejected-bounds' ? '999' : '2000', '200'].entries()) {
				const field = fields[index]
				if (field === undefined) throw new Error('Missing takeover bound')
				await act(() => {
					field.value = value
					field.dispatchEvent(new Event('input', { bubbles: true }))
				})
			}
			const button = view.container.querySelector('button')
			if (button === null) throw new Error('Missing takeover action')
			if (scenario === 'rejected-bounds') {
				await waitFor(() => expect(view.container.textContent).toContain('The resulting pledged REP exceeds your limit.'))
				expect(button.disabled).toBe(true)
			} else await waitFor(() => expect(button.disabled).toBe(false))
			expect(snapshot.ownerCommitmentAttoEth).toBe(0n)
			await act(() => {
				button.click()
			})
			if (scenario !== 'success') {
				if (scenario === 'changed-price') {
					await waitFor(() => expect(failure).toBeDefined(), { timeout: 30_000 })
					expect(String(failure)).toContain(changedSinceReview)
				} else expect(failure).toBeUndefined()
				expect(submitted).toBe(false)
				const after = await loadSecurityPoolCapitalSnapshot({ client: keeper, owner: keeper.account.address, securityPool: fixture.securityPool })
				const sourceAfter = await loadSecurityPoolCapitalSnapshot({ client: keeper, owner: owner.account.address, securityPool: fixture.securityPool })
				expect(after.ownerPrincipalAttoRep).toBe(snapshot.ownerPrincipalAttoRep)
				expect(after.ownerCommitmentAttoEth).toBe(snapshot.ownerCommitmentAttoEth)
				expect(sourceAfter.ownerPrincipalAttoRep).toBe(original.ownerPrincipalAttoRep)
				expect(sourceAfter.ownerCommitmentAttoEth).toBe(original.ownerCommitmentAttoEth)
				return
			}
			await waitFor(
				() => {
					if (failure !== undefined) throw failure
					expect(submitted).toBe(true)
				},
				{ timeout: 30_000 },
			)
			const acquired = await loadSecurityPoolCapitalSnapshot({ client: keeper, owner: keeper.account.address, securityPool: fixture.securityPool })
			expect(acquired.ownerCommitmentAttoEth).toBeGreaterThan(0n)
			expect(acquired.ownerCommitmentAttoEth).toBe(200n * unit)
			const retained = await loadSecurityPoolCapitalSnapshot({ client: keeper, owner: owner.account.address, securityPool: fixture.securityPool })
			expect(retained.ownerPrincipalAttoRep).toBe(0n)
			expect(retained.ownerCommitmentAttoEth + acquired.ownerCommitmentAttoEth).toBe(original.ownerCommitmentAttoEth)
			expect(acquired.ownerPrincipalAttoRep).toBe(snapshot.ownerPrincipalAttoRep + original.ownerPrincipalAttoRep)
		}, 300_000)
})
