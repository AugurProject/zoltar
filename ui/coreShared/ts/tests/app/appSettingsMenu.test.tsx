import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { AppSettingsMenu } from '../../app/components/AppSettingsMenu.js'
import * as appCopy from '../../copy/app.js'
import { readNetworkRpcUrls } from '../../wallet/rpcConfig.js'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { fireEvent, waitFor, within } from '../testUtils/queries.js'

let storageDescriptor: PropertyDescriptor | undefined
const lifecycle = installDomTestLifecycle({
	beforeTest: environment => {
		storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
		Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: environment.window.localStorage })
	},
	afterTest: () => {
		if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
		else Reflect.deleteProperty(globalThis, 'localStorage')
	},
})

async function openSettings() {
	const rendered = lifecycle.trackRendered(await renderIntoDocument(<AppSettingsMenu onEnvironmentChanged={async () => undefined} />))
	await act(() => fireEvent.click(within(rendered.container).getByRole('button', { name: appCopy.settings })))
	const dialog = within(rendered.container).getByRole('dialog', { name: appCopy.applicationSettings })
	const queries = within(dialog)
	const network = queries.getByLabelText(appCopy.rpcNetwork)
	const rpc = queries.getByLabelText(appCopy.fallbackRpcUrl)
	const view = dialog.ownerDocument.defaultView
	if (!view || !(network instanceof view.HTMLSelectElement) || !(rpc instanceof view.HTMLInputElement)) throw new Error('Expected the RPC network and URL controls')
	return { dialog, network, queries, rpc }
}

test('simulation RPC guidance stays quiet and describes the disabled URL control', async () => {
	const { dialog, network, queries, rpc } = await openSettings()
	await act(() => fireEvent.change(network, { target: { value: 'simulation' } }))
	const help = document.getElementById(rpc.getAttribute('aria-describedby') ?? '')
	expect(rpc.disabled).toBe(true)
	expect(help?.textContent).toBe(appCopy.simulationRpcDetail)
	expect(help?.getAttribute('data-message-placement')).toBe('field')
	expect(dialog.querySelector('[aria-live]')).toBeNull()
	expect(queries.getByRole('button', { name: appCopy.saveRpc }).hasAttribute('disabled')).toBe(true)
})

test('an invalid RPC describes its input and a corrected save replaces the error with success feedback', async () => {
	const { network, queries, rpc } = await openSettings()
	await act(() => fireEvent.change(network, { target: { value: 'sepolia' } }))
	await act(() => fireEvent.input(rpc, { target: { value: 'not-a-url' } }))
	await act(() => fireEvent.click(queries.getByRole('button', { name: appCopy.saveRpc })))
	const error = queries.getByRole('alert')
	expect(error.textContent).toContain('absolute https:// URL')
	expect(rpc.getAttribute('aria-describedby')).toBe(error.id)
	expect(rpc.getAttribute('aria-invalid')).toBe('true')
	await act(() => fireEvent.input(rpc, { target: { value: 'https://rpc.example/sepolia' } }))
	await act(() => fireEvent.click(queries.getByRole('button', { name: appCopy.saveRpc })))
	expect(queries.queryByRole('alert')).toBeNull()
	expect(rpc.getAttribute('aria-invalid')).toBeNull()
	const success = await waitFor(() => queries.getByRole('status'))
	expect(success.textContent).toBe(appCopy.rpcSaved)
	expect(success.getAttribute('data-message-tone')).toBe('success')
	expect(readNetworkRpcUrls().sepolia).toBe('https://rpc.example/sepolia')
})
