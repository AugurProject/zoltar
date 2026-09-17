import { expect, test } from 'bun:test'
import { FormField } from '../components/FormField.js'
import { FormInput } from '../components/FormInput.js'
import { RetryableNotice } from '../components/RetryableNotice.js'
import { WalletConnectionControl, WalletNetworkControl } from '../components/WalletConnectionControl.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

let cleanup: (() => Promise<void>) | undefined
installDomTestLifecycle({
	afterTest: async () => {
		await cleanup?.()
		cleanup = undefined
	},
})

test('field labels associate with inputs while FormInput owns error and hint descriptions', async () => {
	const rendered = await renderIntoDocument(
		<FormField id='amount' label='Amount' required>
			<FormInput id='amount' required error='Invalid amount' hint='Enter REP' />
		</FormField>,
	)
	cleanup = rendered.cleanup
	const input = document.querySelector('input')
	expect(document.querySelector('label')?.htmlFor).toBe(input?.id)
	expect(document.querySelector('.required-field-indicator')?.getAttribute('aria-hidden')).toBe('true')
	expect(input?.getAttribute('aria-invalid')).toBe('true')
	const ids = input?.getAttribute('aria-describedby')?.split(' ') ?? []
	expect(ids.map(id => document.getElementById(id)?.textContent)).toEqual(['Invalid amount', 'Enter REP'])
	expect(document.querySelectorAll('.field-error').length).toBe(1)
})

test('pending wallet connection blocks duplicate actions and announces progress', async () => {
	let calls = 0
	const rendered = await renderIntoDocument(
		<WalletConnectionControl
			label='Connect wallet'
			pendingLabel='Connecting'
			pending
			onClick={() => {
				calls++
			}}
		/>,
	)
	cleanup = rendered.cleanup
	const button = document.querySelector('button')
	expect(button?.disabled).toBe(true)
	expect(button?.getAttribute('aria-busy')).toBe('true')
	button?.click()
	expect(calls).toBe(0)
	expect(button?.textContent).toContain('Connecting')
})

test('network action retains its label and callback with a wrong-network badge', async () => {
	let calls = 0
	const rendered = await renderIntoDocument(
		<WalletNetworkControl
			badge='Wrong network'
			label='Switch to Sepolia'
			onClick={() => {
				calls++
			}}
		/>,
	)
	cleanup = rendered.cleanup
	document.querySelector('button')?.click()
	expect(calls).toBe(1)
	expect(document.body.textContent).toContain('Wrong network')
	expect(document.querySelector('button')?.textContent).toBe('Switch to Sepolia')
})

test('retry notice leaves caller-owned data visible and respects disabled retries', async () => {
	let calls = 0
	const rendered = await renderIntoDocument(
		<>
			<p>Previous data</p>
			<RetryableNotice
				message='Refresh failed'
				retryLabel='Retry'
				disabled
				onRetry={() => {
					calls++
				}}
			/>
		</>,
	)
	cleanup = rendered.cleanup
	expect(document.body.textContent).toContain('Previous data')
	expect(document.querySelector('[role="alert"]')?.textContent).toContain('Refresh failed')
	document.querySelector('button')?.click()
	expect(calls).toBe(0)
})
