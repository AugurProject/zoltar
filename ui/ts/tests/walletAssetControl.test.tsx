/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { type Address, zeroAddress } from '@zoltar/shared/ethereum'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { WalletAssetControl } from '../components/WalletAssetControl.js'
import { createInjectedBackend } from '../lib/chainBackend.js'
import { installActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import type { WalletAssetWatchResult } from '../lib/walletAsset.js'
import { createFakeBackend, createFakeSimulationProfile } from './testUtils/fakeBackend.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { fireEvent, waitFor, within } from './testUtils/queries.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

const TOKEN_ADDRESS = '0x00000000000000000000000000000000000000a1'
const NEXT_TOKEN_ADDRESS = '0x00000000000000000000000000000000000000b2'
const ACCOUNT_ADDRESS = '0x00000000000000000000000000000000000000c3'
const NEXT_ACCOUNT_ADDRESS = '0x00000000000000000000000000000000000000d4'

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	const promise = new Promise<T>(promiseResolve => {
		resolve = promiseResolve
	})
	return { promise, resolve }
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
		const renderedComponent = await renderIntoDocument(<WalletAssetControl accountAddress={ACCOUNT_ADDRESS} address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		const addButton = documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' }) as HTMLButtonElement
		expect(addButton.classList.contains('wallet-asset-action-idle')).toBe(true)
		expect(addButton.querySelector('.wallet-asset-action-icon')?.textContent).toBe('+')
		expect(addButton.querySelector('.wallet-asset-action-icon')?.getAttribute('aria-hidden')).toBe('true')

		fireEvent.click(addButton)
		await waitFor(() => {
			const pendingButton = documentQueries.getByRole('button', { name: 'Opening wallet to add Universe 0xa REP' })
			expect(pendingButton.classList.contains('wallet-asset-action-pending')).toBe(true)
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
			expect(acceptedButton.classList.contains('wallet-asset-action-accepted')).toBe(true)
			expect(acceptedButton.querySelector('.wallet-asset-action-icon')?.textContent).toBe('✓')
			expect(acceptedButton.textContent).toContain('Request accepted')
			expect(documentQueries.getByRole('status').textContent).toBe('Universe 0xa REP wallet request accepted')
		})
	})

	test('discards a pending wallet result when the token address changes', async () => {
		const deferred = createDeferred<WalletAssetWatchResult>()
		const onWatchAsset = mock(async (address: Address) => {
			if (address === TOKEN_ADDRESS) return await deferred.promise
			return { status: 'accepted' } satisfies WalletAssetWatchResult
		})
		const renderedComponent = await renderIntoDocument(<WalletAssetControl accountAddress={ACCOUNT_ADDRESS} address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		fireEvent.click(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' }))
		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: 'Opening wallet to add Universe 0xa REP' })).not.toBeNull()
		})

		render(<WalletAssetControl accountAddress={ACCOUNT_ADDRESS} address={NEXT_TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xb REP' onWatchAsset={onWatchAsset} />, renderedComponent.container)
		expect(documentQueries.getByRole('button', { name: 'Add Universe 0xb REP to wallet' })).not.toBeNull()

		await act(async () => {
			deferred.resolve({ status: 'accepted' })
			await deferred.promise
		})
		await waitFor(() => {
			const nextTokenButton = documentQueries.getByRole('button', { name: 'Add Universe 0xb REP to wallet' }) as HTMLButtonElement
			expect(nextTokenButton.disabled).toBe(false)
			expect(documentQueries.queryByRole('status')).toBeNull()
		})

		fireEvent.click(documentQueries.getByRole('button', { name: 'Add Universe 0xb REP to wallet' }))
		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: 'Universe 0xb REP wallet request accepted' })).not.toBeNull()
		})
		expect(onWatchAsset).toHaveBeenCalledTimes(2)
	})

	test('resets accepted state and discards pending results when the wallet account changes', async () => {
		const deferred = createDeferred<WalletAssetWatchResult>()
		const onWatchAsset = mock(async () => (onWatchAsset.mock.calls.length === 1 ? await deferred.promise : ({ status: 'accepted' } satisfies WalletAssetWatchResult)))
		const renderedComponent = await renderIntoDocument(<WalletAssetControl accountAddress={ACCOUNT_ADDRESS} address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		fireEvent.click(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' }))
		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: 'Opening wallet to add Universe 0xa REP' })).not.toBeNull()
		})

		render(<WalletAssetControl accountAddress={NEXT_ACCOUNT_ADDRESS} address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />, renderedComponent.container)
		expect(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' })).not.toBeNull()

		await act(async () => {
			deferred.resolve({ status: 'accepted' })
			await deferred.promise
		})
		expect(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' })).not.toBeNull()

		fireEvent.click(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' }))
		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: 'Universe 0xa REP wallet request accepted' })).not.toBeNull()
		})

		render(<WalletAssetControl accountAddress={ACCOUNT_ADDRESS} address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />, renderedComponent.container)
		expect(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' })).not.toBeNull()
	})

	test('discards a pending result after the supported network changes', async () => {
		const deferred = createDeferred<WalletAssetWatchResult>()
		const onWatchAsset = mock(async () => await deferred.promise)
		const renderedComponent = await renderIntoDocument(<WalletAssetControl accountAddress={ACCOUNT_ADDRESS} address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		fireEvent.click(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' }))
		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: 'Opening wallet to add Universe 0xa REP' })).not.toBeNull()
		})

		render(<WalletAssetControl accountAddress={ACCOUNT_ADDRESS} address={TOKEN_ADDRESS} isSupportedChain={false} tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />, renderedComponent.container)
		render(<WalletAssetControl accountAddress={ACCOUNT_ADDRESS} address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />, renderedComponent.container)

		await act(async () => {
			deferred.resolve({ status: 'accepted' })
			await deferred.promise
		})
		const addButton = documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' }) as HTMLButtonElement
		expect(addButton.disabled).toBe(false)
		expect(documentQueries.queryByRole('status')).toBeNull()
	})

	test('shows manual-import recovery and allows retrying an unsupported request', async () => {
		const onWatchAsset = mock(async (_address: Address): Promise<WalletAssetWatchResult> => ({ status: 'unsupported' }))
		const renderedComponent = await renderIntoDocument(<WalletAssetControl accountAddress={ACCOUNT_ADDRESS} address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		fireEvent.click(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' }))
		await waitFor(() => {
			expect(documentQueries.getByRole('alert').textContent).toBe('Automatic import unavailable. Copy the token address to import it manually.')
			const retryButton = documentQueries.getByRole('button', { name: 'Retry adding Universe 0xa REP to wallet' })
			expect(retryButton.classList.contains('wallet-asset-action-error')).toBe(true)
			expect(retryButton.querySelector('.wallet-asset-action-icon')?.textContent).toBe('↻')
		})
	})

	test('shows retry recovery when the wallet request fails unexpectedly', async () => {
		const onWatchAsset = mock(async (_address: Address): Promise<WalletAssetWatchResult> => {
			throw new Error('Wallet RPC unavailable')
		})
		const renderedComponent = await renderIntoDocument(<WalletAssetControl accountAddress={ACCOUNT_ADDRESS} address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		fireEvent.click(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' }))
		await waitFor(() => {
			expect(documentQueries.getByRole('alert').textContent).toBe('Unable to send the token request to your wallet. Try again.')
			expect(documentQueries.getByRole('button', { name: 'Retry adding Universe 0xa REP to wallet' })).not.toBeNull()
		})
	})

	test('shows retry recovery when the wallet rejects with a malformed value', async () => {
		const onWatchAsset = mock(async () => {
			throw 'wallet unavailable'
		})
		const renderedComponent = await renderIntoDocument(<WalletAssetControl accountAddress={ACCOUNT_ADDRESS} address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />)
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
		const renderedComponent = await renderIntoDocument(<WalletAssetControl accountAddress={ACCOUNT_ADDRESS} address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' onWatchAsset={onWatchAsset} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		fireEvent.click(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' }))
		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: 'Add Universe 0xa REP to wallet' })).not.toBeNull()
			expect(documentQueries.queryByRole('alert')).toBeNull()
		})
	})

	test('disables the request on the wrong network with a direct reason', async () => {
		const renderedComponent = await renderIntoDocument(<WalletAssetControl accountAddress={ACCOUNT_ADDRESS} address={TOKEN_ADDRESS} isSupportedChain={false} tokenLabel='Universe 0xa REP' />)
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
		const renderedComponent = await renderIntoDocument(<WalletAssetControl accountAddress={ACCOUNT_ADDRESS} address={TOKEN_ADDRESS} isSupportedChain tokenLabel='Universe 0xa REP' />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		expect(documentQueries.queryByRole('button', { name: 'Add Universe 0xa REP to wallet' })).toBeNull()
		expect(documentQueries.getByRole('button', { name: `Copy address ${TOKEN_ADDRESS}` })).not.toBeNull()
	})
})
