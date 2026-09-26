/// <reference types="bun-types" />

import { signal } from '@preact/signals'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { ActionLauncherButton } from '../components/ActionLauncherButton.js'
import { TransactionActionButton, TransactionActionGroup } from '../components/TransactionActionButton.js'
import { WalletActionsProvider, type WalletActions } from '../components/WalletActionFix.js'
import type { ActionAvailability } from '../types/components.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { fireEvent, within } from './testUtils/queries.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

const disconnectedAvailability: ActionAvailability = { disabled: true, reason: 'Connect a wallet before creating a question.', walletBlocker: { kind: 'wallet-disconnected' } }
const wrongNetworkAvailability: ActionAvailability = { disabled: true, reason: 'Switch to Sepolia.', walletBlocker: { kind: 'wrong-network', targetChainName: 'Sepolia' } }

function createWalletActions(overrides: Partial<WalletActions> = {}) {
	const calls: string[] = []
	const walletActions: WalletActions = {
		isConnectingWallet: false,
		isManagingWallet: false,
		onConnect: () => calls.push('connect'),
		onSwitchNetwork: () => calls.push('switch'),
		...overrides,
	}
	return { calls, walletActions }
}

describe('wallet action fix', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('offers the connect fix where a disconnected wallet reason would be', async () => {
		const { calls, walletActions } = createWalletActions()
		const rendered = await renderIntoDocument(
			<WalletActionsProvider walletActions={walletActions}>
				<form onSubmit={() => calls.push('submit')}>
					<TransactionActionButton availability={disconnectedAvailability} idleLabel='Create question' onClick={() => calls.push('create')} pendingLabel='Creating…' type='submit' />
				</form>
			</WalletActionsProvider>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const page = within(document.body)
		const action = page.getByRole('button', { name: 'Create question' })
		const fix = page.getByRole('button', { name: 'Connect wallet' })
		expect(action.hasAttribute('disabled')).toBe(true)
		expect(action.getAttribute('aria-describedby')).toBe(fix.id)
		expect(fix.getAttribute('type')).toBe('button')
		expect(page.queryByRole('note')).toBeNull()
		await act(() => fireEvent.click(fix))
		expect(calls).toEqual(['connect'])
	})

	test('offers the switch fix for a wallet on another network', async () => {
		const { calls, walletActions } = createWalletActions()
		const rendered = await renderIntoDocument(
			<WalletActionsProvider walletActions={walletActions}>
				<TransactionActionButton availability={wrongNetworkAvailability} idleLabel='Create pool' onClick={() => undefined} pendingLabel='Creating…' />
			</WalletActionsProvider>,
		)
		cleanupRenderedComponent = rendered.cleanup
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Switch to Sepolia' })))
		expect(calls).toEqual(['switch'])
	})

	test('shows the pending wallet request inside the disabled fix', async () => {
		const { walletActions } = createWalletActions({ isConnectingWallet: true })
		const rendered = await renderIntoDocument(
			<WalletActionsProvider walletActions={walletActions}>
				<TransactionActionButton availability={disconnectedAvailability} idleLabel='Create question' onClick={() => undefined} pendingLabel='Creating…' />
			</WalletActionsProvider>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const fix = rendered.container.querySelector('.tx-action-wallet-fix')
		expect(fix?.hasAttribute('disabled')).toBe(true)
		expect(fix?.getAttribute('aria-busy')).toBe('true')
		expect(fix?.textContent).toContain('Connecting…')
	})

	test('keeps the text reason without wallet actions or a typed wallet blocker', async () => {
		const { walletActions } = createWalletActions()
		const rendered = await renderIntoDocument(
			<>
				<TransactionActionButton availability={disconnectedAvailability} idleLabel='Without provider' onClick={() => undefined} pendingLabel='Pending' />
				<WalletActionsProvider walletActions={walletActions}>
					<TransactionActionButton availability={{ disabled: true, reason: 'Switch to Sepolia.' }} idleLabel='Untyped reason' onClick={() => undefined} pendingLabel='Pending' />
				</WalletActionsProvider>
			</>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const page = within(document.body)
		expect(page.queryByRole('button', { name: 'Connect wallet' })).toBeNull()
		expect(page.queryByRole('button', { name: 'Switch to Sepolia' })).toBeNull()
		expect(page.getByRole('note', { name: 'Without provider details' }).textContent).toContain('Connect a wallet before creating a question.')
		expect(page.getByRole('note', { name: 'Untyped reason details' }).textContent).toContain('Switch to Sepolia.')
	})

	test('returns focus to the unblocked action after the wallet connects', async () => {
		const state = signal<{ availability: ActionAvailability; connecting: boolean }>({ availability: disconnectedAvailability, connecting: false })
		const Harness = () => (
			<WalletActionsProvider
				walletActions={{
					isConnectingWallet: state.value.connecting,
					isManagingWallet: false,
					onConnect: () => {
						state.value = { ...state.value, connecting: true }
					},
					onSwitchNetwork: () => undefined,
				}}
			>
				<TransactionActionButton availability={state.value.availability} idleLabel='Create question' onClick={() => undefined} pendingLabel='Creating…' />
			</WalletActionsProvider>
		)
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup
		const page = within(document.body)
		const fix = page.getByRole('button', { name: 'Connect wallet' })
		fix.focus()
		await act(() => fireEvent.click(fix))
		expect(fix.hasAttribute('disabled')).toBe(true)
		fix.blur()
		await act(() => {
			state.value = { availability: { disabled: false, reason: undefined }, connecting: false }
		})
		const action = page.getByRole('button', { name: 'Create question' })
		expect(action.hasAttribute('disabled')).toBe(false)
		expect(page.queryByRole('button', { name: 'Connect wallet' })).toBeNull()
		expect(document.activeElement).toBe(action)
	})

	test('does not move focus later when the connected action stays disabled for another reason', async () => {
		const state = signal<{ availability: ActionAvailability; connecting: boolean }>({ availability: disconnectedAvailability, connecting: false })
		const Harness = () => (
			<WalletActionsProvider
				walletActions={{
					isConnectingWallet: state.value.connecting,
					isManagingWallet: false,
					onConnect: () => {
						state.value = { ...state.value, connecting: true }
					},
					onSwitchNetwork: () => undefined,
				}}
			>
				<TransactionActionButton availability={state.value.availability} idleLabel='Create question' onClick={() => undefined} pendingLabel='Creating…' />
			</WalletActionsProvider>
		)
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup
		const page = within(document.body)
		const fix = page.getByRole('button', { name: 'Connect wallet' })
		fix.focus()
		await act(() => fireEvent.click(fix))
		fix.blur()
		await act(() => {
			state.value = { availability: { disabled: true, reason: 'Enter a title.' }, connecting: false }
		})
		expect(document.activeElement).toBe(document.body)
		// Disconnecting later from elsewhere brings the fix back without taking focus.
		await act(() => {
			state.value = { availability: disconnectedAvailability, connecting: false }
		})
		expect(document.activeElement).toBe(document.body)
		await act(() => {
			state.value = { availability: { disabled: false, reason: undefined }, connecting: false }
		})
		expect(document.activeElement).toBe(document.body)
	})

	test('places the fix under a grouped action and describes the action by the group notice and the fix', async () => {
		const { walletActions } = createWalletActions()
		const rendered = await renderIntoDocument(
			<WalletActionsProvider walletActions={walletActions}>
				<TransactionActionGroup id='fork-notice' message='Connect wallet to continue.'>
					<TransactionActionButton availability={{ disabled: true, reason: 'Approve first.' }} idleLabel='Approve REP' onClick={() => undefined} pendingLabel='Approving…' />
					<TransactionActionButton availability={disconnectedAvailability} idleLabel='Fork Universe' onClick={() => undefined} pendingLabel='Forking…' />
				</TransactionActionGroup>
			</WalletActionsProvider>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const page = within(document.body)
		const fix = page.getByRole('button', { name: 'Connect wallet' })
		expect(page.getByRole('button', { name: 'Fork Universe' }).getAttribute('aria-describedby')).toBe(`fork-notice ${fix.id}`)
		expect(page.getByRole('button', { name: 'Approve REP' }).getAttribute('aria-describedby')).toBe('fork-notice')
		expect(fix.closest('.tx-action')?.textContent).toContain('Fork Universe')
	})

	test('offers the fix on a launcher blocked only by the wallet', async () => {
		const { calls, walletActions } = createWalletActions()
		const rendered = await renderIntoDocument(
			<WalletActionsProvider walletActions={walletActions}>
				<ActionLauncherButton availability={{ disabled: true, reason: undefined, walletBlocker: { kind: 'wallet-disconnected' } }} idleLabel='Deposit REP' onClick={() => undefined} pendingLabel='Opening…' />
			</WalletActionsProvider>,
		)
		cleanupRenderedComponent = rendered.cleanup
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Connect wallet' })))
		expect(calls).toEqual(['connect'])
	})
})
