import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, getAddress } from '@zoltar/shared/ethereum'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '../../../../ui/coreShared/ts/tests/testUtils/domEnvironment.ts'
import { App } from '../app/App.tsx'
import { TradingDeploymentSetup, type TradingDeploymentSetupServices } from '../features/TradingDeploymentSetup.tsx'
import { CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE, deploymentConfigurationForPlan, getTradingDeploymentPlan } from '../protocol/deployment.ts'
import { renderIntoDocument } from './test-support/renderIntoDocument.tsx'

const core = {
	chainId: 11_155_111,
	chainName: 'Sepolia',
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
	for (let attempt = 0; attempt < 100; attempt++) {
		await act(async () => {
			await Bun.sleep(10)
		})
		if (document.body.textContent?.includes(text)) return
	}
	throw new Error(`Timed out waiting for ${text}`)
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
		const rendered = await renderIntoDocument(<TradingDeploymentSetup configurationError='No deployment configured' onComplete={() => undefined} services={services} />)
		cleanupRendered = rendered.cleanup
		await act(async () => {
			await Bun.sleep(0)
		})
		const select = rendered.container.querySelector<HTMLSelectElement>('select')
		const rpcInput = rendered.container.querySelector<HTMLInputElement>('input[type="url"]')
		if (select === null || rpcInput === null) throw new Error('Deployment setup fields are unavailable')
		await act(async () => {
			select.value = core.chainId.toString()
			select.dispatchEvent(new Event('change', { bubbles: true }))
			rpcInput.value = 'https://rpc.example'
			rpcInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await act(async () => {
			await Bun.sleep(30)
		})
		expect(rendered.container.textContent).toContain('Ready to deploy')
		expect(rendered.container.textContent).toContain('Immutable trading fee')
		expect(rendered.container.textContent).toContain('Deploy Two-way trading factory')
		expect(rendered.container.textContent).toContain('0 / 2')
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
		const rendered = await renderIntoDocument(<TradingDeploymentSetup configurationError={undefined} onComplete={() => undefined} services={services} />)
		cleanupRendered = rendered.cleanup
		await waitForText('Loading networks')
		const select = rendered.container.querySelector<HTMLSelectElement>('select')
		if (select === null) throw new Error('Deployment network field is unavailable')
		expect(select.disabled).toBe(true)
		if (rejectInitial === undefined) throw new Error('Initial registry rejection is unavailable')
		rejectInitial(new Error('Registry unavailable'))
		await waitForText('Registry unavailable')
		const failedStatus = rendered.container.querySelector('.deployment-setup__status .status')
		expect(failedStatus?.textContent).toContain('Networks unavailable')
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
		await waitForText('Enter network settings')
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
		const rendered = await renderIntoDocument(<TradingDeploymentSetup configurationError={undefined} onComplete={() => undefined} services={services} />)
		cleanupRendered = rendered.cleanup
		await act(async () => await Bun.sleep(0))
		const select = rendered.container.querySelector<HTMLSelectElement>('select')
		const rpcInput = rendered.container.querySelector<HTMLInputElement>('input[type="url"]')
		if (select === null || rpcInput === null) throw new Error('Deployment setup fields are unavailable')
		await act(async () => {
			select.value = core.chainId.toString()
			select.dispatchEvent(new Event('change', { bubbles: true }))
			rpcInput.value = 'https://rpc.example'
			rpcInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
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
		expect(rendered.container.textContent).not.toContain('Deploy Two-way trading factory')
		expect(select.disabled).toBe(true)
		expect(rpcInput.value).toBe('https://rpc.example')
	})

	test('retries a failed automatic RPC inspection without losing the selected settings', async () => {
		let rpcAvailable = false
		const services: TradingDeploymentSetupServices = {
			createPublicClient: () => deploymentClient(() => rpcAvailable),
			loadCoreDeployments: async () => [core],
			saveConfiguration: () => undefined,
		}
		const rendered = await renderIntoDocument(<TradingDeploymentSetup configurationError={undefined} onComplete={() => undefined} services={services} />)
		cleanupRendered = rendered.cleanup
		await act(async () => {
			await Bun.sleep(0)
		})
		const select = rendered.container.querySelector<HTMLSelectElement>('select')
		const rpcInput = rendered.container.querySelector<HTMLInputElement>('input[type="url"]')
		if (select === null || rpcInput === null) throw new Error('Deployment setup fields are unavailable')
		await act(async () => {
			select.value = core.chainId.toString()
			select.dispatchEvent(new Event('change', { bubbles: true }))
			rpcInput.value = 'https://rpc.example'
			rpcInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
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
		expect(rpcInput.value).toBe('https://rpc.example')
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
		const rendered = await renderIntoDocument(<TradingDeploymentSetup configurationError={undefined} onComplete={() => undefined} services={services} />)
		cleanupRendered = rendered.cleanup
		await act(async () => await Bun.sleep(0))
		const select = rendered.container.querySelector<HTMLSelectElement>('select')
		const rpcInput = rendered.container.querySelector<HTMLInputElement>('input[type="url"]')
		const feeInput = rendered.container.querySelector<HTMLInputElement>('.amount-input input')
		if (select === null || rpcInput === null || feeInput === null) throw new Error('Deployment setup fields are unavailable')
		await act(async () => {
			select.value = core.chainId.toString()
			select.dispatchEvent(new Event('change', { bubbles: true }))
			rpcInput.value = 'https://rpc.example'
			rpcInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await waitForText('Ready to deploy')
		const action = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent?.includes('Deploy Two-way trading factory') === true)
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
		const rendered = await renderIntoDocument(<TradingDeploymentSetup configurationError={undefined} onComplete={() => undefined} services={services} />)
		cleanupRendered = rendered.cleanup
		await act(async () => await Bun.sleep(0))
		const select = rendered.container.querySelector<HTMLSelectElement>('select')
		const rpcInput = rendered.container.querySelector<HTMLInputElement>('input[type="url"]')
		if (select === null || rpcInput === null) throw new Error('Deployment setup fields are unavailable')
		await act(async () => {
			select.value = core.chainId.toString()
			select.dispatchEvent(new Event('change', { bubbles: true }))
			rpcInput.value = 'https://rpc.example'
			rpcInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await waitForText('Ready to deploy')
		const action = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent?.includes('Deploy Two-way trading factory') === true)
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
		const rendered = await renderIntoDocument(<App deploymentSetupServices={services} loadLiveDeployment={async () => await configurationPending} />)
		cleanupRendered = rendered.cleanup
		await waitForText('Enter network settings')
		const select = rendered.container.querySelector<HTMLSelectElement>('.deployment-setup select')
		const rpcInput = rendered.container.querySelector<HTMLInputElement>('.deployment-setup input[type="url"]')
		if (select === null || rpcInput === null) throw new Error('Deployment setup fields are unavailable')
		await act(async () => {
			select.value = core.chainId.toString()
			select.dispatchEvent(new Event('change', { bubbles: true }))
			rpcInput.value = 'https://rpc.example'
			rpcInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await waitForText('Ready to deploy')
		const action = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent?.includes('Deploy Two-way trading factory') === true)
		if (!(action instanceof HTMLButtonElement)) throw new Error('Factory deployment action is unavailable')
		await act(async () => {
			action.click()
			await Bun.sleep(0)
		})
		expect(deployCount).toBe(1)
		const pendingStatus = rendered.container.querySelector('.deployment-setup__status .status')
		expect(pendingStatus?.textContent).toContain('Deployment in progress')
		expect(pendingStatus?.classList.contains('status--neutral')).toBe(true)
		if (resolveConfiguration === undefined) throw new Error('Configuration resolver is unavailable')
		resolveConfiguration(loadedConfiguration)
		await act(async () => await Bun.sleep(20))
		expect(rendered.container.textContent).toContain('Deployment in progress')
		const pendingAction = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent?.includes('Deploying Two-way trading factory') === true)
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
		const select = rendered.container.querySelector<HTMLSelectElement>('.deployment-setup select')
		const rpcInput = rendered.container.querySelector<HTMLInputElement>('.deployment-setup input[type="url"]')
		const feeInput = rendered.container.querySelector<HTMLInputElement>('.deployment-setup .amount-input input')
		expect(select?.value).toBe(core.chainId.toString())
		expect(rpcInput?.value).toBe(configuration.rpcUrl)
		expect(feeInput?.value).toBe('47')
		expect(rendered.container.textContent).toContain('2 / 2')
		expect(rendered.container.textContent).not.toContain('Ready to deploy')
		expect(Array.from(rendered.container.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Deployment complete')).toBe(false)
	})
})
