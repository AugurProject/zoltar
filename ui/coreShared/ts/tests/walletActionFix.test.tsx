/// <reference types="bun-types" />

import { signal } from '@preact/signals'
import { useRef } from 'preact/hooks'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { ActionLauncherButton } from '../components/ActionLauncherButton.js'
import { ActionLauncherCard } from '../components/ActionLauncherCard.js'
import { TransactionActionButton, TransactionActionButtonLockProvider, TransactionActionGroup, TransactionScopeProvider } from '../components/TransactionActionButton.js'
import { WalletActionFixReason, WalletActionsProvider } from '../components/WalletActionFix.js'
import type { ActionAvailability } from '../types/components.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { fireEvent, within } from './testUtils/queries.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { createWalletActions } from './testUtils/walletActions.js'

const disconnectedAvailability: ActionAvailability = { disabled: true, reason: 'Connect a wallet before creating a question.', walletBlocker: { kind: 'wallet-disconnected' } }
const wrongNetworkAvailability: ActionAvailability = { disabled: true, reason: 'Switch to Sepolia.', walletBlocker: { kind: 'wrong-network', targetChainName: 'Sepolia' } }

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
					<TransactionActionButton availability={disconnectedAvailability} idleLabel='Fork universe' onClick={() => undefined} pendingLabel='Forking…' />
				</TransactionActionGroup>
			</WalletActionsProvider>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const page = within(document.body)
		const fix = page.getByRole('button', { name: 'Connect wallet' })
		expect(page.getByRole('button', { name: 'Fork universe' }).getAttribute('aria-describedby')).toBe(`fork-notice ${fix.id}`)
		expect(page.getByRole('button', { name: 'Approve REP' }).getAttribute('aria-describedby')).toBe('fork-notice')
		expect(fix.closest('.tx-action')?.textContent).toContain('Fork universe')
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

	test('offers the fix on a launcher card only while its wallet state blocks a shown blocker', async () => {
		const { walletActions } = createWalletActions()
		const action = { actionLabel: 'Mint', blocker: 'Connect a wallet before minting complete sets.', key: 'mint', readiness: 'blocked' as const, title: 'Mint complete sets' }
		const rendered = await renderIntoDocument(
			<WalletActionsProvider walletActions={walletActions}>
				<ActionLauncherCard action={action} walletBlocksFirst={{ accountAddress: undefined, isOnActiveAppChain: true }} />
				<ActionLauncherCard action={{ ...action, blocker: 'Select a pool.', key: 'no-wallet-state', title: 'Without wallet state' }} />
			</WalletActionsProvider>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const page = within(document.body)
		expect(page.getAllByRole('button', { name: 'Connect wallet' })).toHaveLength(1)
		expect(page.getByRole('note', { name: 'Mint details' }).textContent).toContain('Select a pool.')
	})

	for (const promptOpen of [false, true])
		test(`keeps the wallet fix instead of the pending-transaction reason under a transaction lock (prompt open: ${String(promptOpen)})`, async () => {
			const { walletActions } = createWalletActions()
			const rendered = await renderIntoDocument(
				<WalletActionsProvider walletActions={walletActions}>
					<TransactionActionButtonLockProvider lock={{ lockedScopes: [['security-pool:0xa']], promptOpen }}>
						<TransactionScopeProvider scope={['security-pool:0xa']}>
							<TransactionActionButton availability={disconnectedAvailability} idleLabel='Deposit REP' onClick={() => undefined} pendingLabel='Depositing REP' />
						</TransactionScopeProvider>
					</TransactionActionButtonLockProvider>
				</WalletActionsProvider>,
			)
			cleanupRenderedComponent = rendered.cleanup
			const page = within(document.body)
			const fix = page.getByRole('button', { name: 'Connect wallet' })
			expect(page.getByRole('button', { name: 'Deposit REP' }).getAttribute('aria-describedby')).toBe(fix.id)
			expect(document.body.textContent).not.toContain('Wait for the pending transaction to confirm.')
		})

	test('holds the fix in a shared reason element that several actions name as their description', async () => {
		const { calls, walletActions } = createWalletActions()
		const rendered = await renderIntoDocument(
			<WalletActionsProvider walletActions={walletActions}>
				<WalletActionFixReason availability={wrongNetworkAvailability} id='shared-reason'>
					<p id='shared-reason'>Switch to Sepolia.</p>
				</WalletActionFixReason>
				<TransactionActionButton availability={wrongNetworkAvailability} disabledReasonElementId='shared-reason' idleLabel='Settle selected' onClick={() => undefined} pendingLabel='Settling…' showDisabledReason={false} />
				<TransactionActionButton availability={wrongNetworkAvailability} disabledReasonElementId='shared-reason' idleLabel='Settle all' onClick={() => undefined} pendingLabel='Settling…' showDisabledReason={false} />
			</WalletActionsProvider>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const page = within(document.body)
		const fix = page.getByRole('button', { name: 'Switch to Sepolia' })
		expect(fix.id).toBe('shared-reason')
		expect(page.getAllByRole('button', { name: 'Switch to Sepolia' })).toHaveLength(1)
		expect(page.getByRole('button', { name: 'Settle selected' }).getAttribute('aria-describedby')).toBe('shared-reason')
		expect(page.getByRole('button', { name: 'Settle all' }).getAttribute('aria-describedby')).toBe('shared-reason')
		expect(document.body.textContent).not.toContain('Switch to Sepolia.')
		await act(() => fireEvent.click(fix))
		expect(calls).toEqual(['switch'])
	})

	test('keeps the shared text reason for other blockers or without wallet actions', async () => {
		const { walletActions } = createWalletActions()
		const rendered = await renderIntoDocument(
			<>
				<WalletActionFixReason availability={disconnectedAvailability} id='without-provider'>
					<p id='without-provider'>Connect a wallet before creating a question.</p>
				</WalletActionFixReason>
				<WalletActionsProvider walletActions={walletActions}>
					<WalletActionFixReason availability={{ disabled: true, reason: 'Loading reporting details.' }} id='other-reason'>
						<p id='other-reason'>Loading reporting details.</p>
					</WalletActionFixReason>
				</WalletActionsProvider>
			</>,
		)
		cleanupRenderedComponent = rendered.cleanup
		expect(within(document.body).queryByRole('button')).toBeNull()
		expect(document.getElementById('without-provider')?.textContent).toBe('Connect a wallet before creating a question.')
		expect(document.getElementById('other-reason')?.textContent).toBe('Loading reporting details.')
	})

	test('returns focus from a shared fix to the action it unblocked', async () => {
		const state = signal<{ availability: ActionAvailability; connecting: boolean }>({ availability: disconnectedAvailability, connecting: false })
		const Harness = () => {
			const actionButtonRef = useRef<HTMLButtonElement>(null)
			return (
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
					<WalletActionFixReason actionButtonRef={actionButtonRef} availability={state.value.availability} id='report-reason' visible={state.value.availability.reason !== undefined}>
						<p id='report-reason'>{state.value.availability.reason}</p>
					</WalletActionFixReason>
					<TransactionActionButton actionButtonRef={actionButtonRef} availability={state.value.availability} disabledReasonElementId='report-reason' idleLabel='Report Yes' onClick={() => undefined} pendingLabel='Reporting…' showDisabledReason={false} />
				</WalletActionsProvider>
			)
		}
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup
		const page = within(document.body)
		const fix = page.getByRole('button', { name: 'Connect wallet' })
		fix.focus()
		await act(() => fireEvent.click(fix))
		fix.blur()
		await act(() => {
			state.value = { availability: { disabled: false, reason: undefined }, connecting: false }
		})
		expect(page.queryByRole('button', { name: 'Connect wallet' })).toBeNull()
		expect(document.activeElement).toBe(page.getByRole('button', { name: 'Report Yes' }))
	})
})
