import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/shared/ethereum'
import { coreDeploymentFromManifest } from '../../ui/build/core-deployments.mts'
import { defaultCoreDeploymentRpcUrls } from '../../ui/ts/protocol/coreDeploymentDefaults.ts'
import { parseCoreDeployments } from '../../ui/ts/protocol/coreDeployments.ts'

describe('trading core deployment registry', () => {
	test('copies the canonical deployment proxy and SecurityPoolFactory from a Zoltar manifest', () => {
		const proxyDeployer = getAddress(`0x${'12'.repeat(20)}`)
		const securityPoolFactory = getAddress(`0x${'34'.repeat(20)}`)
		expect(
			coreDeploymentFromManifest({
				network: { chainId: 11_155_111, id: 'sepolia', name: 'Sepolia' },
				deploymentSteps: [
					{ id: 'proxyDeployer', address: proxyDeployer },
					{ id: 'securityPoolFactory', address: securityPoolFactory },
				],
			}),
		).toEqual({ chainId: 11_155_111, chainName: 'Sepolia', rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com', id: 'sepolia', proxyDeployer, securityPoolFactory })
	})

	test('rejects a manifest without the required canonical deployment steps', () => {
		expect(() => coreDeploymentFromManifest({ network: { chainId: 1, id: 'mainnet', name: 'Mainnet' }, deploymentSteps: [] })).toThrow('proxyDeployer')
	})

	test('uses one default RPC registry for build and runtime deployment choices', () => {
		const proxyDeployer = getAddress(`0x${'12'.repeat(20)}`)
		const securityPoolFactory = getAddress(`0x${'34'.repeat(20)}`)
		for (const [chainIdText, rpcUrl] of Object.entries(defaultCoreDeploymentRpcUrls)) {
			const chainId = Number(chainIdText)
			const manifestDeployment = coreDeploymentFromManifest({
				network: { chainId, id: `chain-${chainIdText}`, name: `Chain ${chainIdText}` },
				deploymentSteps: [
					{ id: 'proxyDeployer', address: proxyDeployer },
					{ id: 'securityPoolFactory', address: securityPoolFactory },
				],
			})
			const [runtimeDeployment] = parseCoreDeployments([{ chainId, chainName: `Chain ${chainIdText}`, id: `chain-${chainIdText}`, proxyDeployer, securityPoolFactory }])
			expect(manifestDeployment.rpcUrl).toBe(rpcUrl)
			expect(runtimeDeployment?.defaultRpcUrl).toBe(rpcUrl)
		}
	})
})
