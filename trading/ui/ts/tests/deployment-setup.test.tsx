import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, getAddress } from '@zoltar/shared/ethereum'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '../../../../ui/ts/tests/testUtils/domEnvironment.ts'
import { App } from '../app/App.tsx'
import { TradingDeploymentSetup, type TradingDeploymentSetupServices } from '../features/TradingDeploymentSetup.tsx'
import { CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE, deploymentConfigurationForPlan, getTradingDeploymentPlan } from '../protocol/deployment.ts'
import type { InjectedEthereum } from '../protocol/injected.ts'
import { renderIntoDocument } from './test-support/renderIntoDocument.tsx'

const core = {
	chainId: 11_155_111,
	chainName: 'Sepolia',
	defaultRpcUrl: 'https://rpc.example',
	id: 'sepolia',
	proxyDeployer: getAddress(`0x${'12'.repeat(20)}`),
	securityPoolFactory: getAddress(`0x${'34'.repeat(20)}`),
}

function deploymentClient(rpcAvailable: () => boolean = () => true) {
	return createPublicClient({
		transport: custom(
			{
				request: async ({ method, params }) => {
					if (!rpcAvailable()) throw new Error('RPC unavailable')
					if (method === 'eth_chainId') return '0xaa36a7'
					if (method === 'eth_getCode' && Array.isArray(params)) {
						const address = params[0]
						if (typeof address === 'string' && address.toLowerCase() === core.proxyDeployer.toLowerCase()) return CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE
						return typeof address === 'string' && address.toLowerCase() === core.securityPoolFactory.toLowerCase() ? '0x01' : '0x'
					}
					throw new Error(`Unexpected RPC method ${method}`)
				},
			},
			{ retryCount: 0 },
		),
	})
}

async function waitForText(text: string) {
	for (let attempt = 0; attempt < 300; attempt++) {
		await act(async () => {
			await Bun.sleep(10)
		})
		if (document.body.textContent?.includes(text)) return
	}
	throw new Error(`Timed out waiting for ${text}: ${document.body.textContent ?? ''}`)
}

async function enterNetworkSettings(container: HTMLElement, rpc: string = 'https://rpc.example') {
	await act(async () => {
		const details = container.querySelector<HTMLDetailsElement>('.deployment-settings')
		if (details === null) throw new Error('Advanced deployment configuration is unavailable')
		details.open = true
		const rpcInput = details.querySelector<HTMLInputElement>('input[type="url"]')
		if (rpcInput === null) throw new Error('Deployment RPC field is unavailable')
		rpcInput.value = rpc
		rpcInput.dispatchEvent(new Event('input', { bubbles: true }))
	})
}

const testWalletAccount = getAddress(`0x${'ab'.repeat(20)}`)
const walletServices = {
	connectWallet: async () => ({ account: testWalletAccount, chainId: core.chainId }),
}

async function connectDeploymentWallet(container: HTMLElement) {
	const connect = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Connect wallet')
	if (!(connect instanceof HTMLButtonElement)) throw new Error(`Connect wallet button is unavailable: ${container.textContent ?? ''}`)
	await act(async () => {
		connect.click()
		await Bun.sleep(0)
	})
}

describe('trading deployment setup', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRendered: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment('http://localhost/#/markets').cleanup
	})

	afterEach(async () => {
		await cleanupRendered?.()
		cleanupRendered = undefined
		cleanupDom?.()
		cleanupDom = undefined
	})

	test('automatically verifies selected network settings and exposes the first deployment step', async () => {
		const client = deploymentClient()
		const services: TradingDeploymentSetupServices = {
			createPublicClient: () => client,
			loadCoreDeployments: async () => [core],
			saveConfiguration: () => undefined,
		}
		const rendered = await renderIntoDocument(<TradingDeploymentSetup onComplete={() => undefined} services={services} />)
		cleanupRendered = rendered.cleanup
		await waitForText('Ready to deploy')
		expect(rendered.container.querySelector('h1')?.textContent).toBe('Deploy')
		expect(rendered.container.textContent).toContain('Deploy and verify the shared deterministic contracts that back the application.')
		expect(rendered.container.textContent).not.toContain('No bundled or wallet-deployed trading configuration was found.')
		expect(rendered.container.textContent).toContain('Trading contracts')
		expect(rendered.container.textContent).toContain('Next to deploy')
		expect(rendered.container.textContent).toContain('Deploy Trading factory')
		expect(rendered.container.textContent).toContain('0 / 2')
	})

	test('keeps advanced configuration closed for a hydrated normalized default RPC', async () => {
		const canonicalRpcUrl = 'https://ethereum-sepolia-rpc.publicnode.com'
		const canonicalCore = { ...core, defaultRpcUrl: canonicalRpcUrl }
		const configuration = deploymentConfigurationForPlan(getTradingDeploymentPlan(canonicalCore, 30), `${canonicalRpcUrl}/`)
		const services = { createPublicClient: () => deploymentClient(), loadCoreDeployments: async () => [canonicalCore], saveConfiguration: () => undefined }
		const rendered = await renderIntoDocument(<TradingDeploymentSetup currentConfiguration={configuration} onComplete={() => undefined} services={services} />)
		cleanupRendered = rendered.cleanup
		await waitForText('Ready to deploy')
		expect(rendered.container.querySelector<HTMLDetailsElement>('.deployment-settings')?.open).toBe(false)
		expect(rendered.container.textContent).not.toContain('Use default RPC')
	})

	test('rejects a wallet snapshot changed between authoritative account and chain reads', async () => {
		const listeners = new Map<string, (...args: unknown[]) => void>()
		const provider: InjectedEthereum = {
			on: (eventName, handler) => listeners.set(eventName, handler),
			removeListener: (eventName, handler) => {
				if (listeners.get(eventName) === handler) listeners.delete(eventName)
			},
			request: async ({ method }) => {
				if (method === 'eth_accounts') {
					listeners.get('accountsChanged')?.([getAddress(`0x${'cd'.repeat(20)}`)])
					return [testWalletAccount]
				}
				if (method === 'eth_chainId') return `0x${core.chainId.toString(16)}`
				throw new Error(`Unexpected wallet method ${method}`)
			},
		}
		const services = { createPublicClient: () => deploymentClient(), connectWallet: async () => ({ account: testWalletAccount, chainId: core.chainId, provider }), getWalletProvider: () => undefined, loadCoreDeployments: async () => [core], saveConfiguration: () => undefined }
		const rendered = await renderIntoDocument(<TradingDeploymentSetup onComplete={() => undefined} services={services} />)
		cleanupRendered = rendered.cleanup
		await waitForText('Ready to deploy')
		await connectDeploymentWallet(rendered.container)
		await waitForText('Wallet context changed during connection')
		expect(rendered.container.textContent).toContain('Not connected')
	})

	test('does not bind a provider returned after deployment setup unmounts', async () => {
		const listeners = new Map<string, (...args: unknown[]) => void>()
		const provider: InjectedEthereum = {
			on: (eventName, handler) => listeners.set(eventName, handler),
			removeListener: (eventName, handler) => {
				if (listeners.get(eventName) === handler) listeners.delete(eventName)
			},
			request: async () => [],
		}
		let resolveConnection: ((connection: { account: string; chainId: number; provider: InjectedEthereum }) => void) | undefined
		const connection = new Promise<{ account: string; chainId: number; provider: InjectedEthereum }>(resolve => {
			resolveConnection = resolve
		})
		const services = { createPublicClient: () => deploymentClient(), connectWallet: async () => await connection, getWalletProvider: () => undefined, loadCoreDeployments: async () => [core], saveConfiguration: () => undefined }
		const rendered = await renderIntoDocument(<TradingDeploymentSetup onComplete={() => undefined} services={services} />)
		await waitForText('Ready to deploy')
		const connect = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Connect wallet')
		if (!(connect instanceof HTMLButtonElement)) throw new Error('Connect wallet button is unavailable')
		await act(async () => connect.click())
		await rendered.cleanup()
		cleanupRendered = undefined
		if (resolveConnection === undefined) throw new Error('Wallet connection resolver is unavailable')
		resolveConnection({ account: testWalletAccount, chainId: core.chainId, provider })
		await Bun.sleep(0)
		expect(listeners.size).toBe(0)
	})

	test('keeps the persistent wallet control disabled until a deployment network is ready', async () => {
		let connectCount = 0
		const services: TradingDeploymentSetupServices = {
			createPublicClient: () => deploymentClient(),
			connectWallet: async () => {
				connectCount += 1
				return { account: testWalletAccount, chainId: core.chainId }
			},
			loadCoreDeployments: async () => await new Promise<readonly (typeof core)[]>(() => undefined),
			saveConfiguration: () => undefined,
		}
		const rendered = await renderIntoDocument(
			<App
				deploymentSetupServices={services}
				loadLiveDeployment={async () => {
					throw new Error('No deployment configured')
				}}
			/>,
		)
		cleanupRendered = rendered.cleanup
		await waitForText('Loading networks')
		expect(rendered.container.querySelector('.site-header .deployment-settings')).not.toBeNull()
		expect(rendered.container.querySelector('.deployment-setup input[type="url"]')).toBeNull()
		const walletButton = rendered.container.querySelector<HTMLButtonElement>('.site-header .wallet-button')
		if (walletButton === null) throw new Error('Persistent wallet button is unavailable')
		expect(walletButton.disabled).toBe(true)
		await act(async () => walletButton.click())
		expect(connectCount).toBe(0)
		expect(rendered.container.querySelector('.route-header .wallet-button')).toBeNull()
	})

	test('announces registry loading and clears its error while retrying', async () => {
		let rejectInitial: ((reason: Error) => void) | undefined
		let resolveRetry: ((deployments: readonly (typeof core)[]) => void) | undefined
		const initialLoad = new Promise<readonly (typeof core)[]>((_resolve, reject) => {
			rejectInitial = reject
		})
		const retryLoad = new Promise<readonly (typeof core)[]>(resolve => {
			resolveRetry = resolve
		})
		let loadCount = 0
		const services: TradingDeploymentSetupServices = {
			createPublicClient: () => deploymentClient(),
			loadCoreDeployments: async () => await (++loadCount === 1 ? initialLoad : retryLoad),
			saveConfiguration: () => undefined,
		}
		const rendered = await renderIntoDocument(<TradingDeploymentSetup onComplete={() => undefined} services={services} />)
		cleanupRendered = rendered.cleanup
		await waitForText('Loading networks')
		const select = rendered.container.querySelector<HTMLSelectElement>('select')
		if (select === null) throw new Error('Deployment network field is unavailable')
		expect(select.disabled).toBe(true)
		if (rejectInitial === undefined) throw new Error('Initial registry rejection is unavailable')
		rejectInitial(new Error('Registry unavailable'))
		await waitForText('Registry unavailable')
		const failedStatus = Array.from(rendered.container.querySelectorAll('.deployment-setup__status .status')).find(element => element.textContent?.includes('Networks unavailable') === true)
		expect(failedStatus).toBeDefined()
		expect(failedStatus?.classList.contains('status--warn')).toBe(true)
		const retry = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Retry checks')
		if (!(retry instanceof HTMLButtonElement)) throw new Error('Retry checks button is unavailable')
		await act(async () => {
			retry.click()
		})
		expect(rendered.container.textContent).not.toContain('Registry unavailable')
		expect(rendered.container.textContent).toContain('Loading networks')
		expect(Array.from(rendered.container.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Retry checks' && !button.disabled)).toBe(false)
		if (resolveRetry === undefined) throw new Error('Retry registry resolver is unavailable')
		resolveRetry([core])
		await waitForText('Ready to deploy')
	})

	test('removes stale registry data and deployment actions when a registry refresh fails', async () => {
		let rpcAvailable = false
		let registryLoads = 0
		const services: TradingDeploymentSetupServices = {
			createPublicClient: () => deploymentClient(() => rpcAvailable),
			loadCoreDeployments: async () => {
				registryLoads += 1
				if (registryLoads > 1) throw new Error('Registry refresh failed')
				return [core]
			},
			saveConfiguration: () => undefined,
		}
		const rendered = await renderIntoDocument(<TradingDeploymentSetup onComplete={() => undefined} services={services} />)
		cleanupRendered = rendered.cleanup
		await act(async () => await Bun.sleep(0))
		const select = rendered.container.querySelector<HTMLSelectElement>('select')
		if (select === null) throw new Error('Deployment setup fields are unavailable')
		await enterNetworkSettings(rendered.container)
		await waitForText('RPC unavailable')
		const retry = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Retry checks')
		if (!(retry instanceof HTMLButtonElement)) throw new Error('Retry checks button is unavailable')
		rpcAvailable = true
		await act(async () => {
			retry.click()
		})
		await waitForText('Registry refresh failed')
		expect(rendered.container.textContent).toContain('Networks unavailable')
		expect(rendered.container.textContent).not.toContain('SecurityPoolFactory')
		expect(rendered.container.textContent).not.toContain('Deploy Trading factory')
		expect(select.disabled).toBe(true)
		const rpcInput = rendered.container.querySelector<HTMLInputElement>('.deployment-settings input[type="url"]')
		expect(rpcInput?.value).toBe('https://rpc.example')
	})

	test('retries a failed automatic RPC inspection without losing the selected settings', async () => {
		let rpcAvailable = false
		const services: TradingDeploymentSetupServices = {
			createPublicClient: () => deploymentClient(() => rpcAvailable),
			loadCoreDeployments: async () => [core],
			saveConfiguration: () => undefined,
		}
		const rendered = await renderIntoDocument(<TradingDeploymentSetup onComplete={() => undefined} services={services} />)
		cleanupRendered = rendered.cleanup
		await act(async () => {
			await Bun.sleep(0)
		})
		const select = rendered.container.querySelector<HTMLSelectElement>('select')
		if (select === null) throw new Error('Deployment setup fields are unavailable')
		await enterNetworkSettings(rendered.container)
		await waitForText('RPC unavailable')
		expect(rendered.container.textContent).toContain('RPC unavailable')
		const retry = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Retry checks')
		if (!(retry instanceof HTMLButtonElement)) throw new Error('Retry checks button is unavailable')
		rpcAvailable = true
		await act(async () => {
			retry.click()
		})
		await waitForText('Ready to deploy')
		expect(select.value).toBe(core.chainId.toString())
		const rpcInput = rendered.container.querySelector<HTMLInputElement>('.deployment-settings input[type="url"]')
		expect(rpcInput?.value).toBe('https://rpc.example')
		expect(rendered.container.textContent).toContain('Ready to deploy')
	})

	test('invalidates a verified plan synchronously when deployment inputs change', async () => {
		let deployCount = 0
		let rpcAvailable = true
		const services: TradingDeploymentSetupServices = {
			createPublicClient: () => deploymentClient(() => rpcAvailable),
			deployStep: async () => {
				deployCount += 1
			},
			loadCoreDeployments: async () => [core],
			saveConfiguration: () => undefined,
		}
		const rendered = await renderIntoDocument(<TradingDeploymentSetup onComplete={() => undefined} services={{ ...services, ...walletServices }} />)
		cleanupRendered = rendered.cleanup
		await act(async () => await Bun.sleep(0))
		const feeInput = rendered.container.querySelector<HTMLInputElement>('.amount-input input')
		if (feeInput === null) throw new Error('Deployment setup fields are unavailable')
		await waitForText('Ready to deploy')
		await connectDeploymentWallet(rendered.container)
		const action = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent?.includes('Deploy Trading factory') === true)
		if (!(action instanceof HTMLButtonElement)) throw new Error('Factory deployment action is unavailable')
		await act(async () => {
			rpcAvailable = false
			feeInput.value = '31'
			feeInput.dispatchEvent(new Event('input', { bubbles: true }))
			action.click()
		})
		expect(deployCount).toBe(0)
	})

	test('reports a failed recovery read without hiding the deployment error', async () => {
		let rpcAvailable = true
		const services: TradingDeploymentSetupServices = {
			createPublicClient: () => deploymentClient(() => rpcAvailable),
			deployStep: async () => {
				rpcAvailable = false
				throw new Error('Deployment submission failed')
			},
			loadCoreDeployments: async () => [core],
			saveConfiguration: () => undefined,
		}
		const rendered = await renderIntoDocument(<TradingDeploymentSetup onComplete={() => undefined} services={{ ...services, ...walletServices }} />)
		cleanupRendered = rendered.cleanup
		await act(async () => await Bun.sleep(0))
		await waitForText('Ready to deploy')
		await connectDeploymentWallet(rendered.container)
		await waitForText('Connected')
		expect(rendered.container.querySelector('.wallet-button')?.getAttribute('aria-label')).toBe(`Disconnect wallet ${testWalletAccount}`)
		const action = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent?.includes('Deploy Trading factory') === true)
		if (!(action instanceof HTMLButtonElement)) throw new Error('Factory deployment action is unavailable')
		await act(async () => {
			action.click()
		})
		await waitForText('Deployment submission failed')
		expect(rendered.container.textContent).toContain('Unable to verify deployment status: RPC unavailable')
		const feedback = Array.from(rendered.container.querySelectorAll('[role="alert"]')).find(element => element.textContent?.includes('Deployment submission failed') === true)
		expect(feedback?.classList.contains('error')).toBe(true)
	})

	test('keeps the app route locked while a deployment transaction is pending', async () => {
		window.history.replaceState(undefined, '', '/#/deploy')
		const loadedConfiguration = deploymentConfigurationForPlan(getTradingDeploymentPlan(core, 30), 'https://rpc.example/')
		let resolveConfiguration: ((configuration: typeof loadedConfiguration) => void) | undefined
		const configurationPending = new Promise<typeof loadedConfiguration>(resolve => {
			resolveConfiguration = resolve
		})
		let resolveDeployment: (() => void) | undefined
		const deploymentPending = new Promise<void>(resolve => {
			resolveDeployment = resolve
		})
		let deployCount = 0
		const services: TradingDeploymentSetupServices = {
			createPublicClient: () => deploymentClient(),
			deployStep: async (_client, _plan, _step, onSubmitted) => {
				deployCount += 1
				onSubmitted(`0x${'ab'.repeat(32)}`)
				await deploymentPending
			},
			loadCoreDeployments: async () => [core],
			saveConfiguration: () => undefined,
		}
		const rendered = await renderIntoDocument(<App deploymentSetupServices={{ ...services, ...walletServices }} loadLiveDeployment={async () => await configurationPending} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('.site-header .wallet-button')).not.toBeNull()
		expect(rendered.container.querySelector('.route-header .wallet-button')).toBeNull()
		await waitForText('Ready to deploy')
		await connectDeploymentWallet(rendered.container)
		await waitForText('Connected')
		for (let attempt = 0; attempt < 30; attempt++) {
			if (rendered.container.querySelector('.site-header .wallet-button')?.getAttribute('aria-label') === `Disconnect wallet ${testWalletAccount}`) break
			await act(async () => {
				await Bun.sleep(10)
			})
		}
		expect(rendered.container.querySelector('.site-header .wallet-button')?.getAttribute('aria-label')).toBe(`Disconnect wallet ${testWalletAccount}`)
		const action = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent?.includes('Deploy Trading factory') === true)
		if (!(action instanceof HTMLButtonElement)) throw new Error('Factory deployment action is unavailable')
		await act(async () => {
			action.click()
			await Bun.sleep(0)
		})
		expect(deployCount).toBe(1)
		const pendingStatus = Array.from(rendered.container.querySelectorAll('.deployment-setup__status .status')).find(element => element.textContent?.includes('Deployment in progress') === true)
		if (pendingStatus === undefined) throw new Error('Deployment in progress status is unavailable')
		expect(pendingStatus.classList.contains('status--neutral')).toBe(true)
		if (resolveConfiguration === undefined) throw new Error('Configuration resolver is unavailable')
		resolveConfiguration(loadedConfiguration)
		await act(async () => await Bun.sleep(20))
		expect(rendered.container.textContent).toContain('Deployment in progress')
		const pendingAction = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent?.includes('Deploying Trading factory') === true)
		if (!(pendingAction instanceof HTMLButtonElement)) throw new Error('Pending factory deployment action is unavailable')
		expect(pendingAction.disabled).toBe(true)
		await act(async () => {
			pendingAction.click()
		})
		expect(deployCount).toBe(1)
		await act(async () => {
			window.location.hash = '#/help'
			window.dispatchEvent(new Event('hashchange'))
		})
		expect(window.location.hash).toBe('#/deploy')
		expect(deployCount).toBe(1)
		if (resolveDeployment === undefined) throw new Error('Deployment resolver is unavailable')
		resolveDeployment()
		await act(async () => await Bun.sleep(0))
	})

	test('hydrates the deploy route from asynchronously resolved configuration', async () => {
		window.history.replaceState(undefined, '', '/#/deploy')
		const plan = getTradingDeploymentPlan(core, 47)
		const configuration = deploymentConfigurationForPlan(plan, 'https://rpc.example/')
		let contractReadCount = 0
		const client = createPublicClient({
			transport: custom({
				request: async ({ method, params }) => {
					if (method === 'eth_chainId') return '0xaa36a7'
					if (method === 'eth_getCode' && Array.isArray(params)) {
						const address = params[0]
						if (typeof address !== 'string') throw new Error('Missing code address')
						if (address.toLowerCase() === core.proxyDeployer.toLowerCase()) return CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE
						if ([core.securityPoolFactory, plan.factory.address, plan.router.address].some(expected => expected.toLowerCase() === address.toLowerCase())) return '0x01'
						return '0x'
					}
					if (method === 'eth_call') {
						contractReadCount += 1
						if (contractReadCount % 3 === 1) return encodeAbiParameters([{ type: 'address' }], [core.securityPoolFactory])
						if (contractReadCount % 3 === 2) return encodeAbiParameters([{ type: 'uint16' }], [plan.feeBps])
						return encodeAbiParameters([{ type: 'address' }], [plan.factory.address])
					}
					throw new Error(`Unexpected RPC method ${method}`)
				},
			}),
		})
		let resolveConfiguration: ((value: typeof configuration) => void) | undefined
		const configurationPending = new Promise<typeof configuration>(resolve => {
			resolveConfiguration = resolve
		})
		const services: TradingDeploymentSetupServices = {
			createPublicClient: () => client,
			loadCoreDeployments: async () => [core],
			saveConfiguration: () => undefined,
		}
		const rendered = await renderIntoDocument(<App deploymentSetupServices={services} loadLiveDeployment={async () => await configurationPending} />)
		cleanupRendered = rendered.cleanup
		if (resolveConfiguration === undefined) throw new Error('Configuration resolver is unavailable')
		resolveConfiguration(configuration)
		await waitForText('Deployment complete')
		const select = rendered.container.querySelector<HTMLSelectElement>('.deployment-settings select')
		const rpcInput = rendered.container.querySelector<HTMLInputElement>('.deployment-settings input[type="url"]')
		const feeInput = rendered.container.querySelector<HTMLInputElement>('.deployment-settings .amount-input input')
		expect(select?.value).toBe(core.chainId.toString())
		expect(rpcInput?.value).toBe(configuration.rpcUrl)
		expect(feeInput?.value).toBe('47')
		expect(rendered.container.textContent).toContain('2 / 2')
		expect(rendered.container.textContent).not.toContain('Ready to deploy')
		expect(Array.from(rendered.container.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Deployment complete')).toBe(false)
	})
})
