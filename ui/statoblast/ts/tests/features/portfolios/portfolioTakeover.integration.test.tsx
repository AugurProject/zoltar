import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { PortfolioTakeover } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfolioTakeover.js'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { loadPortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { useSecurityPoolPortfolioFixture, unit } from '../../../../../../solidity/ts/tests/statoblast/securityPoolPortfolioFixture'
import { writeContractAndWait } from '../../../../../../solidity/ts/testSupport/simulator/utils/clients'
import { getRepTokenAddress } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { ReputationToken_ReputationToken as token } from '../../../../../../solidity/ts/types/contractArtifact'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
describe('manual takeover against native portfolio contracts', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	test('form bounds produce a mined acquisition and move liability only after confirmation', async () => {
		await fixture.prepare()
		await fixture.mint(200n * unit)
		const owner = fixture.owner()
		const keeper = fixture.other()
		await writeContractAndWait(owner, () => owner.writeContract({ abi: token.abi, address: getRepTokenAddress(fixture.base.genesisUniverse), functionName: 'transfer', args: [keeper.account.address, 1000n * unit] }))
		await fixture.deposit(1000n * unit, keeper)
		await fixture.refreshPrice(fixture.base.questionId, 3n * unit)
		await fixture.base.mockWindow.advanceTime(3601n)
		await fixture.refreshPrice(fixture.base.questionId, 3n * unit)
		const snapshot = await loadPortfolioCapitalSnapshot({ client: keeper, owner: keeper.account.address, portfolio: fixture.portfolio })
		const original = await loadPortfolioCapitalSnapshot({ client: keeper, owner: owner.account.address, portfolio: fixture.portfolio })
		const source = original.positions[0]
		if (source === undefined) throw new Error('Missing distressed position')
		const backend = { ...createFakeBackend({ accountAddress: keeper.account.address }), createReadClient: () => keeper }
		installActiveEnvironmentForTesting(backend, backend)
		let submitted = false
		let failure: unknown
		const actions = {
			ownerReason: undefined,
			scope: undefined,
			busy: undefined,
			runPortfolioAction: async (_action: string, _label: string, build: () => PortfolioTransaction | Promise<PortfolioTransaction>) => {
				try {
					const request = await build()
					await request.validateBeforeSubmit?.()
					await writeContractAndWait(keeper, () => keeper.sendTransaction({ ...request, gas: 8_000_000n }))
					submitted = true
				} catch (error) {
					failure = error
				}
			},
		}
		const view = await renderIntoDocument(<PortfolioTakeover model={{ snapshot }} actions={actions} />)
		lifecycle.trackRendered(view)
		const fields = view.container.querySelectorAll('input')
		for (const [index, value] of [source.id.toString(), '200', '0', '1000', '2000', '200'].entries()) {
			const field = fields[index]
			if (field === undefined) throw new Error('Missing takeover bound')
			await act(() => {
				field.value = value
				field.dispatchEvent(new Event('input', { bubbles: true }))
			})
		}
		const button = view.container.querySelector('button')
		if (button === null) throw new Error('Missing takeover action')
		await waitFor(() => expect(button.disabled).toBe(false))
		expect(snapshot.ownerCommitmentAttoEth).toBe(0n)
		await act(() => button.click())
		await waitFor(
			() => {
				if (failure !== undefined) throw failure
				expect(submitted).toBe(true)
			},
			{ timeout: 30_000 },
		)
		const acquired = await loadPortfolioCapitalSnapshot({ client: keeper, owner: keeper.account.address, portfolio: fixture.portfolio })
		expect(acquired.ownerCommitmentAttoEth).toBe(200n * unit)
		expect((await loadPortfolioCapitalSnapshot({ client: keeper, owner: owner.account.address, portfolio: fixture.portfolio })).ownerCommitmentAttoEth).toBe(0n)
		expect(acquired.ownerPrincipalAttoRep).toBeGreaterThan(snapshot.ownerPrincipalAttoRep)
	}, 300_000)
})
