import { expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createMockLoaderClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { loadSecurityPoolRegistry } from '../../protocol/live.js'
import { deploymentConfigurationForPlan, getTradingDeploymentPlan } from '../../protocol/deployment.js'
import { getInfraContractAddresses, PROXY_DEPLOYER_ADDRESS } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

const addresses = getInfraContractAddresses(SEPOLIA_NETWORK_PROFILE)
const configuration = deploymentConfigurationForPlan(getTradingDeploymentPlan({ chainId: 11155111, chainName: 'Sepolia', defaultRpcUrl: 'http://localhost', id: 'sepolia', proxyDeployer: PROXY_DEPLOYER_ADDRESS, securityPoolFactory: addresses.securityPoolFactory, zoltar: addresses.zoltar }, 30), 'http://localhost')

test('pages the current pool registry and filters the requested universe without logs', async () => {
	const ranges: unknown[] = []
	const client = createMockLoaderClient({
		getBlock: async () => ({ timestamp: 0n }),
		getLogs: async () => {
			throw new Error('Log access unavailable')
		},
		multicall: async () => [],
		readContract: async request => {
			expect(request.blockNumber).toBe(100_000n)
			if (request.functionName === 'securityPoolDeploymentCount') return 205n
			if (request.functionName !== 'securityPoolDeploymentsRange') throw new Error(`Unexpected read ${request.functionName}`)
			const [start, count] = request.args ?? []
			if (typeof start !== 'bigint' || typeof count !== 'bigint') throw new Error('Missing registry range')
			ranges.push([start, count])
			return Array.from({ length: Number(count) }, (_, offset) => ({
				securityPool: getAddress(`0x${(start + BigInt(offset) + 1n).toString(16).padStart(40, '0')}`),
				shareToken: zeroAddress,
				universeId: (start + BigInt(offset)) % 2n,
				questionId: 1n,
				statoblastSecurityMultiplierBps: 10_000n,
				initialReportPriorityFeeAttoEthPerGas: 1n,
			}))
		},
	})
	const deployments = await loadSecurityPoolRegistry(client, configuration, 1n, 100_000n)
	expect(ranges).toEqual([
		[0n, 100n],
		[100n, 100n],
		[200n, 5n],
	])
	expect(deployments).toHaveLength(102)
	expect(deployments.every(deployment => deployment.universeId === 1n)).toBe(true)
	await expect(loadSecurityPoolRegistry(client, configuration, 1n, 100_000n, () => false)).rejects.toThrow('cancelled')
})
