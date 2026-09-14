import { afterEach, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { MainnetDisabledNotice } from '../../app/components/MainnetDisabledNotice.js'
import { AppHeaderShell } from '../../app/components/AppHeaderShell.js'
import { installActiveEnvironmentForTesting } from '../../lib/activeEnvironment.js'
import { createFakeBackend, createFakeSimulationProfile } from '../testUtils/fakeBackend.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { fireEvent, waitFor, within } from '../testUtils/queries.js'

let cleanup: () => Promise<void> = async () => undefined
afterEach(async () => await cleanup())

test('notice only shows the notice for a connected mainnet wallet and follows wallet events', async () => {
	const dom = installDomEnvironment()
	let chainId = '0x1'
	let connected = false
	let refreshAccounts: () => void = () => undefined
	let refreshChain: () => void = () => undefined
	const backend = createFakeBackend()
	backend.getAccounts = async () => (connected ? [zeroAddress] : [])
	backend.getChainId = async () => chainId
	backend.subscribeAccountsChanged = handler => {
		refreshAccounts = handler
		return () => {
			refreshAccounts = () => undefined
		}
	}
	backend.subscribeChainChanged = handler => {
		refreshChain = handler
		return () => {
			refreshChain = () => undefined
		}
	}
	const restore = installActiveEnvironmentForTesting(backend)
	const rendered = await renderIntoDocument(<AppHeaderShell overview={<MainnetDisabledNotice />} simulationController={undefined} onRefresh={async () => undefined} />)
	cleanup = async () => {
		await rendered.cleanup()
		restore()
		dom.cleanup()
	}
	const notice = () => within(rendered.container).queryByText('Ethereum mainnet is disabled.')
	expect(notice()).toBeNull()
	connected = true
	refreshAccounts()
	await waitFor(() => expect(notice()).not.toBeNull())
	chainId = '0xaa36a7'
	refreshChain()
	await waitFor(() => expect(notice()).toBeNull())
	chainId = '0x01'
	refreshChain()
	await waitFor(() => expect(notice()).not.toBeNull())
	connected = false
	refreshAccounts()
	await waitFor(() => expect(notice()).toBeNull())
})

test('simulation has no mainnet notice and settings offer only Sepolia and simulation', async () => {
	const dom = installDomEnvironment()
	const backend = createFakeBackend({ accountAddress: zeroAddress, profile: createFakeSimulationProfile() })
	backend.getChainId = async () => '0x1'
	const restore = installActiveEnvironmentForTesting(backend)
	const rendered = await renderIntoDocument(<AppHeaderShell overview={<MainnetDisabledNotice />} simulationController={undefined} onRefresh={async () => undefined} />)
	cleanup = async () => {
		await rendered.cleanup()
		restore()
		dom.cleanup()
	}
	expect(rendered.container.textContent).not.toContain('mainnet is disabled')
	fireEvent.click(within(rendered.container).getByRole('button', { name: 'Settings' }))
	expect(
		within(rendered.container)
			.getAllByRole('option')
			.map(option => option.textContent),
	).toEqual(['Sepolia', 'Browser Simulation'])
})
