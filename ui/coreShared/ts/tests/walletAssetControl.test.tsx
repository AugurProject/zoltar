import { createDeferred } from './testUtils/deferred.js'
/// <reference types='bun-types' />

import { type Address, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, mock, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { WalletAssetControl } from '../components/WalletAssetControl.js'
import { installActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { createInjectedBackend } from '../wallet/chainBackend.js'
import type { WalletAssetWatchResult } from '../wallet/walletAsset.js'
import { createFakeBackend, createFakeSimulationProfile } from './testUtils/fakeBackend.js'
import { fireEvent, waitFor, within } from './testUtils/queries.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

const TOKEN_ADDRESS = '0x00000000000000000000000000000000000000a1'
const NEXT_TOKEN_ADDRESS = '0x00000000000000000000000000000000000000b2'
const ACCOUNT_ADDRESS = '0x00000000000000000000000000000000000000c3'
const NEXT_ACCOUNT_ADDRESS = '0x00000000000000000000000000000000000000d4'
const CASE_VARIANT_TOKEN_ADDRESS = '0x00000000000000000000000000000000000000A1'
const CASE_VARIANT_ACCOUNT_ADDRESS = '0x00000000000000000000000000000000000000C3'

type WalletAssetControlProps = Parameters<typeof WalletAssetControl>[0]

const controlProps = (overrides: Partial<WalletAssetControlProps> = {}): WalletAssetControlProps => ({ accountAddress: ACCOUNT_ADDRESS, address: TOKEN_ADDRESS, isSupportedChain: true, tokenLabel: 'Universe 0xa REP', ...overrides })
const documentQueries = () => within(document.body)
const addButton = (tokenLabel = 'Universe 0xa REP') => documentQueries().getByRole('button', { name: `Add ${tokenLabel} to wallet` }) as HTMLButtonElement
const clickAdd = (tokenLabel = 'Universe 0xa REP') => fireEvent.click(addButton(tokenLabel))
const waitForButton = async (name: string) =>
	await waitFor(() => {
		expect(documentQueries().getByRole('button', { name })).not.toBeNull()
	})
const waitForPending = async () => await waitForButton('Opening wallet to add Universe 0xa REP')
const waitForAccepted = async (tokenLabel = 'Universe 0xa REP') => await waitForButton(`${tokenLabel} wallet request accepted`)

async function resolveAccepted(deferred: ReturnType<typeof createDeferred<WalletAssetWatchResult>>) {
	await act(async () => {
		deferred.resolve({ status: 'accepted' })
		await deferred.promise
	})
}

describe('WalletAssetControl', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restoreActiveEnvironment: (() => void) | undefined

	installDomTestLifecycle({
		beforeTest: domEnvironment => {
			Reflect.set(domEnvironment.window, 'ethereum', {
				request: async () => true,
			})
			restoreActiveEnvironment = installActiveEnvironmentForTesting(createInjectedBackend())
		},
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
			restoreActiveEnvironment?.()
			restoreActiveEnvironment = undefined
		},
	})

	async function renderControl(overrides: Partial<WalletAssetControlProps> = {}) {
		const renderedComponent = await renderIntoDocument(<WalletAssetControl {...controlProps(overrides)} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		return (nextOverrides: Partial<WalletAssetControlProps>) => render(<WalletAssetControl {...controlProps(nextOverrides)} />, renderedComponent.container)
	}

	test('guards duplicate requests and shows the accepted state', async () => {
		const deferred = createDeferred<WalletAssetWatchResult>()
		const onWatchAsset = mock(async (_address: Address) => await deferred.promise)
		await renderControl({ onWatchAsset })
		const idleButton = addButton()
		expect(idleButton.classList.contains('wallet-asset-action-idle')).toBe(true)
		expect(idleButton.querySelector('.wallet-asset-action-icon')?.textContent).toBe('+')
		expect(idleButton.querySelector('.wallet-asset-action-icon')?.getAttribute('aria-hidden')).toBe('true')

		fireEvent.click(idleButton)
		await waitFor(() => {
			const pendingButton = documentQueries().getByRole('button', { name: 'Opening wallet to add Universe 0xa REP' })
			expect(pendingButton.classList.contains('wallet-asset-action-pending')).toBe(true)
		})
		fireEvent.click(idleButton)
		expect(onWatchAsset).toHaveBeenCalledTimes(1)

		await resolveAccepted(deferred)
		await waitFor(() => {
			const acceptedButton = documentQueries().getByRole('button', { name: 'Universe 0xa REP wallet request accepted' }) as HTMLButtonElement
			expect(acceptedButton.disabled).toBe(true)
			expect(acceptedButton.classList.contains('wallet-asset-action-accepted')).toBe(true)
			expect(acceptedButton.querySelector('.wallet-asset-action-icon')?.textContent).toBe('✓')
			expect(acceptedButton.textContent).toContain('Request accepted')
			expect(documentQueries().getByRole('status').textContent).toBe('Universe 0xa REP wallet request accepted')
		})
	})

	test('preserves accepted state across equivalent address casing', async () => {
		const onWatchAsset = mock(async () => ({ status: 'accepted' }) satisfies WalletAssetWatchResult)
		const rerender = await renderControl({ onWatchAsset })

		clickAdd()
		await waitForAccepted()

		rerender({ accountAddress: CASE_VARIANT_ACCOUNT_ADDRESS, address: CASE_VARIANT_TOKEN_ADDRESS, onWatchAsset })

		expect(documentQueries().getByRole('button', { name: 'Universe 0xa REP wallet request accepted' })).not.toBeNull()
	})

	test('discards a pending wallet result when the token address changes', async () => {
		const deferred = createDeferred<WalletAssetWatchResult>()
		const onWatchAsset = mock(async (address: Address) => {
			if (address === TOKEN_ADDRESS) return await deferred.promise
			return { status: 'accepted' } satisfies WalletAssetWatchResult
		})
		const rerender = await renderControl({ onWatchAsset })

		clickAdd()
		await waitForPending()

		rerender({ address: NEXT_TOKEN_ADDRESS, tokenLabel: 'Universe 0xb REP', onWatchAsset })
		expect(addButton('Universe 0xb REP')).not.toBeNull()

		await resolveAccepted(deferred)
		await waitFor(() => {
			expect(addButton('Universe 0xb REP').disabled).toBe(false)
			expect(documentQueries().queryByRole('status')).toBeNull()
		})

		clickAdd('Universe 0xb REP')
		await waitForAccepted('Universe 0xb REP')
		expect(onWatchAsset).toHaveBeenCalledTimes(2)
	})

	test('resets accepted state and discards pending results when the wallet account changes', async () => {
		const deferred = createDeferred<WalletAssetWatchResult>()
		const onWatchAsset = mock(async () => (onWatchAsset.mock.calls.length === 1 ? await deferred.promise : ({ status: 'accepted' } satisfies WalletAssetWatchResult)))
		const rerender = await renderControl({ onWatchAsset })

		clickAdd()
		await waitForPending()

		rerender({ accountAddress: NEXT_ACCOUNT_ADDRESS, onWatchAsset })
		expect(addButton()).not.toBeNull()

		await resolveAccepted(deferred)
		expect(addButton()).not.toBeNull()

		clickAdd()
		await waitForAccepted()

		rerender({ onWatchAsset })
		expect(addButton()).not.toBeNull()
	})

	test('discards a pending result after the supported network changes', async () => {
		const deferred = createDeferred<WalletAssetWatchResult>()
		const onWatchAsset = mock(async () => await deferred.promise)
		const rerender = await renderControl({ onWatchAsset })

		clickAdd()
		await waitForPending()

		rerender({ isSupportedChain: false, onWatchAsset })
		rerender({ onWatchAsset })

		await resolveAccepted(deferred)
		expect(addButton().disabled).toBe(false)
		expect(documentQueries().queryByRole('status')).toBeNull()
	})

	test('shows manual-import recovery and allows retrying an unsupported request', async () => {
		const onWatchAsset = mock(async (_address: Address): Promise<WalletAssetWatchResult> => ({ status: 'unsupported' }))
		await renderControl({ onWatchAsset })

		clickAdd()
		await waitFor(() => {
			expect(documentQueries().getByRole('alert').textContent).toBe('Automatic import unavailable. Copy the token address to import it manually.')
			const retryButton = documentQueries().getByRole('button', { name: 'Retry adding Universe 0xa REP to wallet' })
			expect(retryButton.classList.contains('wallet-asset-action-error')).toBe(true)
			expect(retryButton.querySelector('.wallet-asset-action-icon')?.textContent).toBe('↻')
		})
	})

	test.each([
		{ name: 'fails unexpectedly', rejection: new Error('Wallet RPC unavailable') },
		{ name: 'rejects with a malformed value', rejection: 'wallet unavailable' },
	])('shows retry recovery when the wallet request $name', async ({ rejection }) => {
		const onWatchAsset = mock(async (_address: Address): Promise<WalletAssetWatchResult> => {
			throw rejection
		})
		await renderControl({ onWatchAsset })

		clickAdd()
		await waitFor(() => {
			expect(documentQueries().getByRole('alert').textContent).toBe('Unable to send the token request to your wallet. Try again.')
			expect(documentQueries().getByRole('button', { name: 'Retry adding Universe 0xa REP to wallet' })).not.toBeNull()
		})
	})

	test('returns to idle without an error when the user dismisses the wallet request', async () => {
		const onWatchAsset = mock(async (_address: Address): Promise<WalletAssetWatchResult> => ({ status: 'dismissed' }))
		await renderControl({ onWatchAsset })

		clickAdd()
		await waitFor(() => {
			expect(addButton()).not.toBeNull()
			expect(documentQueries().queryByRole('alert')).toBeNull()
		})
	})

	test('disables the request on the wrong network with a direct reason', async () => {
		await renderControl({ isSupportedChain: false })

		const networkReason = documentQueries().getByText('Switch to Sepolia.')
		expect(addButton().disabled).toBe(true)
		expect(networkReason.id).not.toBe('')
		expect(addButton().getAttribute('aria-describedby')).toBe(networkReason.id)
	})

	test('uses copy-address only in browser simulation', async () => {
		restoreActiveEnvironment?.()
		restoreActiveEnvironment = installActiveEnvironmentForTesting(
			createFakeBackend({
				accountAddress: zeroAddress,
				profile: createFakeSimulationProfile(),
			}),
		)
		await renderControl()

		expect(documentQueries().queryByRole('button', { name: 'Add Universe 0xa REP to wallet' })).toBeNull()
		expect(documentQueries().getByRole('button', { name: `Copy address ${TOKEN_ADDRESS}` })).not.toBeNull()
	})
})
