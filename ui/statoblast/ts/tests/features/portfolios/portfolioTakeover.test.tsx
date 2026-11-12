import { expect, test } from 'bun:test'
import { render } from 'preact'
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

test('entering another target clears the bounds typed for the previous position but a new block keeps them', async () => {
	const snapshot = capitalSnapshot({ totalCommitmentAttoEth: 20n * unit, demandAttoEth: 20n * unit })
	const reader = capitalClient(snapshot)
	reader.setRead('accountOf', { owner: getAddress('0x0000000000000000000000000000000000000099'), batch: 0n, rep: 15n * unit, commitment: 10n * unit, maxHealthyPrice: unit, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }, index)
	reader.setRead('liquidationStarted', 1n, capital)
	reader.setRead('acceptedPriceEpoch', 4n, capital)
	reader.install()
	const actions = { ownerReason: undefined, scope: undefined, busy: undefined, runPortfolioAction: async () => undefined }
	const view = await renderIntoDocument(<PortfolioTakeover model={{ snapshot }} actions={actions} />)
	lifecycle.trackRendered(view)
	const button = view.container.querySelector('button')
	if (button === null) throw new Error('Missing takeover button')
	const fields = Array.from(view.container.querySelectorAll('input'))
	const fill = async (field: HTMLInputElement | undefined, value: string) => {
		if (field === undefined) throw new Error('Missing takeover field')
		await act(() => {
			field.value = value
			field.dispatchEvent(new Event('input', { bubbles: true }))
		})
	}
	for (const [offset, value] of ['2', '10', '1', '20', '200', '100'].entries()) await fill(fields[offset], value)
	await waitFor(() => expect(button.disabled).toBe(false))
	await act(() => render(<PortfolioTakeover model={{ snapshot: { ...snapshot, blockHash: `0x${'ab'.repeat(32)}` } }} actions={actions} />, view.container))
	expect(fields.slice(1).map(field => field.value)).toEqual(['10', '1', '20', '200', '100'])
	await fill(fields[0], '3')
	await waitFor(() => expect(fields.slice(1).map(field => field.value)).toEqual(['', '', '', '', '']))
	await waitFor(() => expect(button.disabled).toBe(true))
	for (const [offset, value] of ['10', '1', '20', '200', '100'].entries()) await fill(fields[offset + 1], value)
	await act(() => render(<PortfolioTakeover model={{ snapshot: { ...snapshot, capitalLedger: getAddress('0x0000000000000000000000000000000000000abc') } }} actions={actions} />, view.container))
	await waitFor(() => expect(fields.slice(1).map(field => field.value)).toEqual(['', '', '', '', '']))
	expect(fields[0]?.value).toBe('3')
})

test('bounds outlive a snapshot reload and a first target, and clear when an ID is retyped as another', async () => {
	const snapshot = capitalSnapshot({ totalCommitmentAttoEth: 20n * unit, demandAttoEth: 20n * unit })
	const reader = capitalClient(snapshot)
	reader.setRead('accountOf', { owner: getAddress('0x0000000000000000000000000000000000000099'), batch: 0n, rep: 15n * unit, commitment: 10n * unit, maxHealthyPrice: unit, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }, index)
	reader.setRead('liquidationStarted', 1n, capital)
	reader.setRead('acceptedPriceEpoch', 4n, capital)
	reader.install()
	const actions = { ownerReason: undefined, scope: undefined, busy: undefined, runPortfolioAction: async () => undefined }
	const view = await renderIntoDocument(<PortfolioTakeover model={{ snapshot }} actions={actions} />)
	lifecycle.trackRendered(view)
	const fields = Array.from(view.container.querySelectorAll('input'))
	const fill = async (field: HTMLInputElement | undefined, value: string) => {
		if (field === undefined) throw new Error('Missing takeover field')
		await act(() => {
			field.value = value
			field.dispatchEvent(new Event('input', { bubbles: true }))
		})
	}
	const bounds = () => fields.slice(1).map(field => field.value)
	const typed = ['10', '1', '20', '200', '100']
	for (const [offset, value] of typed.entries()) await fill(fields[offset + 1], value)
	await fill(fields[0], '5')
	expect(bounds()).toEqual(typed)
	await act(() => render(<PortfolioTakeover model={{ snapshot: undefined }} actions={actions} />, view.container))
	await act(() => render(<PortfolioTakeover model={{ snapshot }} actions={actions} />, view.container))
	expect(bounds()).toEqual(typed)
	await fill(fields[0], '')
	expect(bounds()).toEqual(typed)
	await fill(fields[0], '6')
	await waitFor(() => expect(bounds()).toEqual(['', '', '', '', '']))
})

test.each([
	// Stated as a condition: a report may already be in its challenge period, so asking for another would invite a duplicate.
	['an expired price in an active universe needs a new accepted price', { priceValid: false }, 'A new accepted REP price is required.'],
	['a forked universe cannot take over at all', { priceValid: false, forkTime: 1n }, 'Takeovers require an active universe.'],
])('%s', async (_case, overrides, reason) => {
	const snapshot = capitalSnapshot(overrides)
	const reader = capitalClient(snapshot)
	reader.setRead('accountOf', { owner: getAddress('0x0000000000000000000000000000000000000099'), batch: 0n, rep: 15n * unit, commitment: 10n * unit, maxHealthyPrice: unit, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }, index)
	reader.setRead('liquidationStarted', 1n, capital)
	reader.setRead('acceptedPriceEpoch', 4n, capital)
	reader.install()
	const actions = { ownerReason: undefined, scope: undefined, busy: undefined, runPortfolioAction: async () => undefined }
	const view = await renderIntoDocument(<PortfolioTakeover model={{ snapshot }} actions={actions} />)
	lifecycle.trackRendered(view)
	const field = view.container.querySelector('input')
	if (field === null) throw new Error('Missing takeover target field')
	await act(() => {
		field.value = '2'
		field.dispatchEvent(new Event('input', { bubbles: true }))
	})
	await waitFor(() => expect(view.container.textContent).toContain(reason))
	expect(view.container.querySelector('button')?.disabled).toBe(true)
})
