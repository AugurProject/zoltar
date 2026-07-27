/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { type Address, zeroAddress } from '@zoltar/shared/ethereum'
import { act } from 'preact/test-utils'
import { WalletAssetControl } from '../components/WalletAssetControl.js'
import { MarketOverviewSection } from '../features/markets/components/MarketOverviewSection.js'
import { ChildUniverseDetails } from '../features/universes/components/ChildUniverseDetails.js'
import { createInjectedBackend } from '../lib/chainBackend.js'
import { installActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import type { WalletAssetWatchResult } from '../lib/walletAsset.js'
import type { ZoltarChildUniverseSummary, ZoltarUniverseSummary } from '../types/contracts.js'
import { createFakeBackend, createFakeSimulationProfile } from './testUtils/fakeBackend.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { fireEvent, waitFor, within } from './testUtils/queries.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

const TOKEN_ADDRESS = '0x00000000000000000000000000000000000000a1'

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	const promise = new Promise<T>(promiseResolve => {
		resolve = promiseResolve
	})
	return { promise, resolve }
}

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

describe('WalletAssetControl', () => {
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

	test('guards duplicate requests and shows the accepted state', async () => {
		const deferred = createDeferred<WalletAssetWatchResult>()
		const onWatchAsset = mock(async (_address: Address) => await deferred.promise)
		const renderedComponent = await renderIntoDocument(<WalletAssetControl address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		const addButton = documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' }) as HTMLButtonElement

		fireEvent.click(addButton)
		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: 'Opening wallet to add Universe 0xa REP' })).not.toBeNull()
		})
		fireEvent.click(addButton)
		expect(onWatchAsset).toHaveBeenCalledTimes(1)

		await act(async () => {
			deferred.resolve({ status: 'accepted' })
			await deferred.promise
		})
		await waitFor(() => {
			const acceptedButton = documentQueries.getByRole('button', { name: 'Universe 0xa REP wallet request accepted' }) as HTMLButtonElement
			expect(acceptedButton.disabled).toBe(true)
			expect(acceptedButton.textContent).toBe('Request accepted')
			expect(documentQueries.getByRole('status').textContent).toBe('Universe 0xa REP wallet request accepted')
		})
	})

	test('shows manual-import recovery and allows retrying an unsupported request', async () => {
		const onWatchAsset = mock(async (_address: Address): Promise<WalletAssetWatchResult> => ({ status: 'unsupported' }))
		const renderedComponent = await renderIntoDocument(<WalletAssetControl address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		fireEvent.click(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' }))
		await waitFor(() => {
			expect(documentQueries.getByRole('alert').textContent).toBe('Automatic import unavailable. Copy the token address to import it manually.')
			expect(documentQueries.getByRole('button', { name: 'Retry adding Universe 0xa REP to wallet' })).not.toBeNull()
		})
	})

	test('shows retry recovery when the wallet request fails unexpectedly', async () => {
		const onWatchAsset = mock(async (_address: Address): Promise<WalletAssetWatchResult> => {
			throw new Error('Wallet RPC unavailable')
		})
		const renderedComponent = await renderIntoDocument(<WalletAssetControl address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		fireEvent.click(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' }))
		await waitFor(() => {
			expect(documentQueries.getByRole('alert').textContent).toBe('Unable to send the token request to your wallet. Try again.')
			expect(documentQueries.getByRole('button', { name: 'Retry adding Universe 0xa REP to wallet' })).not.toBeNull()
		})
	})

	test('returns to idle without an error when the user dismisses the wallet request', async () => {
		const onWatchAsset = mock(async (_address: Address): Promise<WalletAssetWatchResult> => ({ status: 'dismissed' }))
		const renderedComponent = await renderIntoDocument(<WalletAssetControl address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		fireEvent.click(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' }))
		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' })).not.toBeNull()
			expect(documentQueries.queryByRole('alert')).toBeNull()
		})
	})

	test('disables the request on the wrong network with a direct reason', async () => {
		const renderedComponent = await renderIntoDocument(<WalletAssetControl address={TOKEN_ADDRESS} isSupportedChain={false} tokenLabel='Universe 0xa REP' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const addButton = within(document.body).getByRole('button', { name: 'Add Universe 0xa REP to wallet' }) as HTMLButtonElement
		const networkReason = within(document.body).getByText('Switch to Ethereum mainnet.')
		expect(addButton.disabled).toBe(true)
		expect(networkReason.id).not.toBe('')
		expect(addButton.getAttribute('aria-describedby')).toBe(networkReason.id)
	})

	test('uses copy-address only in browser simulation', async () => {
		restoreActiveEnvironment?.()
		restoreActiveEnvironment = installActiveEnvironmentForTesting(
			createFakeBackend({
				accountAddress: zeroAddress,
				profile: createFakeSimulationProfile(),
			}),
		)
		const renderedComponent = await renderIntoDocument(<WalletAssetControl address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		expect(documentQueries.queryByRole('button', { name: 'Add Universe 0xa REP to wallet' })).toBeNull()
		expect(documentQueries.getByRole('button', { name: `Copy address ${TOKEN_ADDRESS}` })).not.toBeNull()
	})

	test('adds the control only for deployed child-universe tokens', async () => {
		const deployed = await renderIntoDocument(<ChildUniverseDetails child={createChild()} isSupportedChain />)
		cleanupRenderedComponent = deployed.cleanup
		expect(within(document.body).getByRole('button', { name: 'Add Universe 0xa REP to wallet' })).not.toBeNull()

		await cleanupRenderedComponent()
		cleanupRenderedComponent = undefined
		const undeployed = await renderIntoDocument(<ChildUniverseDetails child={createChild({ exists: false, reputationToken: zeroAddress })} isSupportedChain />)
		cleanupRenderedComponent = undeployed.cleanup
		expect(within(document.body).queryByRole('button', { name: /Add .* REP to wallet/ })).toBeNull()
	})

	test('adds the current universe token control to the overview', async () => {
		const universe = {
			childUniverses: [],
			forkThreshold: 100n,
			forkQuestionDetails: undefined,
			forkTime: 0n,
			forkingOutcomeIndex: 0n,
			hasForked: false,
			parentUniverseId: 0n,
			reputationToken: TOKEN_ADDRESS,
			totalTheoreticalSupply: 1_000n,
			universeId: 0n,
		} satisfies ZoltarUniverseSummary
		const renderedComponent = await renderIntoDocument(
			<MarketOverviewSection accountAddress={zeroAddress} isMainnet loadingZoltarUniverse={false} onCreateChildUniverseForOutcomeIndex={() => undefined} zoltarChildUniverseError={undefined} zoltarChildUniversePendingOutcomeIndex={undefined} zoltarUniverse={universe} zoltarUniverseState='ready' />,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByRole('button', { name: 'Add Genesis (0x0) REP to wallet' })).not.toBeNull()
	})
})
