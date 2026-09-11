import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { coreDeploymentFromManifest } from '../../../build/core-deployments.mts'
import { defaultCoreDeploymentRpcUrls } from '../../protocol/coreDeploymentDefaults.ts'
import { loadCoreDeployments } from '../../protocol/coreDeployments.ts'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { installFetchStub } from '@zoltar/ui-core-shared/tests/testUtils/fetchStub.js'

// Loads a core deployment registry through the public loader with a stubbed fetch and a non-simulation backend.
async function loadCoreDeploymentsFrom(registry: unknown) {
	const restoreEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: MAINNET_NETWORK_PROFILE }))
	const restoreFetch = installFetchStub(async () => new Response(JSON.stringify(registry), { headers: { 'content-type': 'application/json' } }))
	try {
		return await loadCoreDeployments()
	} finally {
		restoreFetch()
		restoreEnvironment()
	}
}

describe('trading core deployment registry', () => {
	test('copies the canonical deployment proxy and SecurityPoolFactory from a Zoltar manifest', () => {
		const proxyDeployer = getAddress(`0x${'12'.repeat(20)}`)
		const securityPoolFactory = getAddress(`0x${'34'.repeat(20)}`)
		const zoltar = getAddress(`0x${'56'.repeat(20)}`)
		expect(
			coreDeploymentFromManifest({
				network: { chainId: 11_155_111, id: 'sepolia', name: 'Sepolia' },
				deploymentSteps: [
					{ id: 'proxyDeployer', address: proxyDeployer },
					{ id: 'securityPoolFactory', address: securityPoolFactory },
					{ id: 'zoltar', address: zoltar },
				],
			}),
		).toEqual({ chainId: 11_155_111, chainName: 'Sepolia', rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com', id: 'sepolia', proxyDeployer, securityPoolFactory, zoltar })
	})

	test('rejects a manifest without the required canonical deployment steps', () => {
		expect(() => coreDeploymentFromManifest({ network: { chainId: 1, id: 'mainnet', name: 'Mainnet' }, deploymentSteps: [] })).toThrow('proxyDeployer')
	})

	test('uses one default RPC registry for build and runtime deployment choices', async () => {
		expect(defaultCoreDeploymentRpcUrls[1]).toBe('https://ethereum.dark.florist')
		const proxyDeployer = getAddress(`0x${'12'.repeat(20)}`)
		const securityPoolFactory = getAddress(`0x${'34'.repeat(20)}`)
		const zoltar = getAddress(`0x${'56'.repeat(20)}`)
		for (const [chainIdText, rpcUrl] of Object.entries(defaultCoreDeploymentRpcUrls)) {
			const chainId = Number(chainIdText)
			const manifestDeployment = coreDeploymentFromManifest({
				network: { chainId, id: `chain-${chainIdText}`, name: `Chain ${chainIdText}` },
				deploymentSteps: [
					{ id: 'proxyDeployer', address: proxyDeployer },
					{ id: 'securityPoolFactory', address: securityPoolFactory },
					{ id: 'zoltar', address: zoltar },
				],
			})
			const [runtimeDeployment] = await loadCoreDeploymentsFrom([{ chainId, chainName: `Chain ${chainIdText}`, id: `chain-${chainIdText}`, proxyDeployer, securityPoolFactory, zoltar }])
			expect(manifestDeployment.rpcUrl).toBe(rpcUrl)
			expect(runtimeDeployment?.defaultRpcUrl).toBe(rpcUrl)
		}
	})
})
