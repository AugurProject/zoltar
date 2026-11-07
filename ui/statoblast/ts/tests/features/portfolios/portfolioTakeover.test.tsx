import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { decodeFunctionData, getAddress } from '@zoltar/core-shared/evm/ethereum'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { PortfolioTakeover } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfolioTakeover.js'
import { statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { capitalSnapshot, index, capital, unit } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
test('manual takeover requires all consent bounds and rejects a changed price before signing', async () => {
	const snapshot = capitalSnapshot({ totalCommitmentAttoEth: 20n * unit, demandAttoEth: 20n * unit })
	const reader = capitalClient(snapshot)
	reader.setRead('accountOf', { owner: getAddress('0x0000000000000000000000000000000000000099'), batch: 0n, rep: 15n * unit, commitment: 10n * unit, maxHealthyPrice: unit, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }, index)
	reader.setRead('liquidationStarted', 1n, capital)
	reader.setRead('acceptedPriceEpoch', 4n, capital)
	reader.install()
	const requests: PortfolioTransaction[] = []
	const actions = {
		ownerReason: undefined,
		scope: undefined,
		busy: undefined,
		runPortfolioAction: async (_action: string, _label: string, build: () => PortfolioTransaction | Promise<PortfolioTransaction>) => {
			requests.push(await build())
		},
	}
	const view = await renderIntoDocument(<PortfolioTakeover model={{ snapshot }} actions={actions} />)
	lifecycle.trackRendered(view)
	const button = view.container.querySelector('button')
	if (button === null) throw new Error('Missing takeover button')
	expect(button.disabled).toBe(true)
	const fields = view.container.querySelectorAll('input')
	for (const [offset, value] of ['2', '10', '1', '20', '200', '100'].entries()) {
		const field = fields[offset]
		if (field === undefined) throw new Error('Missing takeover field')
		await act(() => {
			field.value = value
			field.dispatchEvent(new Event('input', { bubbles: true }))
		})
	}
	await waitFor(() => expect(button.disabled).toBe(false))
	await act(() => button.click())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing takeover transaction')
	const decoded = decodeFunctionData({ abi: capitalArtifact.abi, data: request.data })
	expect(decoded.functionName).toBe('takeOverWithBounds')
	if (decoded.functionName !== 'takeOverWithBounds') throw new Error('Wrong takeover entry point')
	expect(decoded.args).toEqual([2n, 10n * unit, unit, 20n * unit, { maximumOwnerPrincipal: 200n * unit, maximumOwnerCommitment: 100n * unit, expectedTargetHealthFactorBps: snapshot.ownerAccount.targetHealthFactorBps, expectedAcceptedPriceEpoch: 4n, expectedSourceBatch: 0n }])
	await request.validateBeforeSubmit?.()
	reader.setRead('acceptedPriceEpoch', 5n, capital)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('changed')
	reader.setRead('liquidationStarted', 0n, capital)
	const targetField = fields[0]
	if (targetField === undefined) throw new Error('Missing target field')
	await act(() => {
		targetField.value = '3'
		targetField.dispatchEvent(new Event('input', { bubbles: true }))
	})
	await waitFor(() => expect(view.container.textContent).toContain('Not started'))
	expect(button.disabled).toBe(true)
})
