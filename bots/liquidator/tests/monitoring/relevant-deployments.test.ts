import { describe, expect, test } from 'bun:test'
import { discoverRelevantDeployments } from '#monitoring/relevant-deployments'
import { getAddress, zeroAddress } from '../helpers/ethereum.ts'

type Deployment = Readonly<{ parent: `0x${string}`; securityPool: `0x${string}` }>

function address(value: number) {
	return getAddress(`0x${value.toString(16).padStart(40, '0')}`)
}

describe('relevant SecurityPool discovery', () => {
	test('loads only selected, desired, and direct-child deployments regardless of unrelated registry size', async () => {
		const selected = address(1)
		const desired = address(2)
		const child = address(3)
		const desiredChild = address(4)
		const deployments = new Map<string, Deployment>([
			[selected.toLowerCase(), { parent: zeroAddress, securityPool: selected }],
			[desired.toLowerCase(), { parent: zeroAddress, securityPool: desired }],
		])
		const poolQueries: string[] = []
		const parentQueries: string[] = []
		const result = await discoverRelevantDeployments({
			desiredPools: [{ id: 'desired' }],
			loadDeploymentsForParent: async parent => {
				parentQueries.push(parent)
				if (parent.toLowerCase() === selected.toLowerCase()) return [{ parent: selected, securityPool: child }]
				if (parent.toLowerCase() === desired.toLowerCase()) return [{ parent: desired, securityPool: desiredChild }]
				return []
			},
			loadDeploymentsForPool: async pool => {
				poolQueries.push(pool)
				const deployment = deployments.get(pool.toLowerCase())
				return deployment === undefined ? [] : [deployment]
			},
			resolveDesiredPool: async () => desired,
			selectedPools: [selected],
		})

		expect(result.map(deployment => deployment.securityPool)).toEqual([selected, child, desired, desiredChild])
		expect(poolQueries).toEqual([selected, desired])
		expect(parentQueries).toEqual([selected, desired])
	})
})
