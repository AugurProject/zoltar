import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createPublicClient, custom, getAddress } from '@zoltar/shared/ethereum'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '../../../../ui/ts/tests/testUtils/domEnvironment.ts'
import { TradingDeploymentSetup, type TradingDeploymentSetupServices } from '../features/TradingDeploymentSetup.tsx'
import { CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE } from '../protocol/deployment.ts'
import { renderIntoDocument } from './test-support/renderIntoDocument.tsx'

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
		const core = {
			chainId: 11_155_111,
			chainName: 'Sepolia',
			id: 'sepolia',
			proxyDeployer: getAddress(`0x${'12'.repeat(20)}`),
			securityPoolFactory: getAddress(`0x${'34'.repeat(20)}`),
		}
		const client = createPublicClient({
			transport: custom({
				request: async ({ method, params }) => {
					if (method === 'eth_chainId') return '0xaa36a7'
					if (method === 'eth_getCode' && Array.isArray(params)) {
						const address = params[0]
						if (typeof address === 'string' && address.toLowerCase() === core.proxyDeployer.toLowerCase()) return CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE
						return typeof address === 'string' && address.toLowerCase() === core.securityPoolFactory.toLowerCase() ? '0x01' : '0x'
					}
					throw new Error(`Unexpected RPC method ${method}`)
				},
			}),
		})
		const services: TradingDeploymentSetupServices = {
			createPublicClient: () => client,
			loadCoreDeployments: async () => [core],
			saveConfiguration: () => undefined,
		}
		const rendered = await renderIntoDocument(<TradingDeploymentSetup configurationError='No deployment configured' onComplete={() => undefined} onRetryManifest={() => undefined} services={services} />)
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
		expect(rendered.container.textContent).toContain('Deploy Two-way trading factory')
		expect(rendered.container.textContent).toContain('0 / 2')
	})
})
