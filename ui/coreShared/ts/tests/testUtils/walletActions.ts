import { expect } from 'bun:test'
import type { WalletActions } from '../../components/WalletActionFix.js'
import { within } from './queries'

/** Wallet session controls that record which fix the user chose. */
export function createWalletActions(overrides: Partial<WalletActions> = {}) {
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

/** Asserts that every action named `actionLabel` is disabled and described by the enabled wallet fix named `fixLabel`, and returns that fix. */
export function expectWalletFixDescribesAction(scope: HTMLElement, actionLabel: string | RegExp, fixLabel: string) {
	const fixes = within(scope).getAllByRole('button', { name: fixLabel })
	const actions = within(scope).getAllByRole('button', { name: actionLabel })
	for (const action of actions) {
		if (!(action instanceof HTMLButtonElement)) throw new Error('Expected the action to be a button')
		expect(action.disabled).toBe(true)
		const describedBy = (action.getAttribute('aria-describedby') ?? '').split(' ')
		expect(fixes.some(fix => describedBy.includes(fix.id))).toBe(true)
	}
	const fix = fixes[0]
	if (!(fix instanceof HTMLButtonElement)) throw new Error(`Expected the ${fixLabel} fix`)
	expect(fix.disabled).toBe(false)
	expect(fix.type).toBe('button')
	return fix
}
