import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createPublicClient, custom, getAddress } from '@zoltar/shared/ethereum'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '../../../../ui/ts/tests/testUtils/domEnvironment.ts'
import { App } from '../app/App.tsx'
import { TradingDeploymentSetup, type TradingDeploymentSetupServices } from '../features/TradingDeploymentSetup.tsx'
import { CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE } from '../protocol/deployment.ts'
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

	test('keeps the app route locked while a deployment transaction is pending', async () => {
		window.history.replaceState(undefined, '', '/#/deploy')
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
		const rendered = await renderIntoDocument(<App deploymentSetupServices={services} loadLiveDeployment={async () => await Promise.reject(new Error('No deployment configured'))} />)
		cleanupRendered = rendered.cleanup
		await act(async () => await Bun.sleep(0))
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
})
