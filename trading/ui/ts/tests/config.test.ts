import { describe, expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, getAddress } from '@zoltar/shared/ethereum'
import { parseDeploymentSetupInput } from '../protocol/config.ts'
import { parseCoreDeployments } from '../protocol/coreDeployments.ts'
import { loadWalletHeaderBalances, validateRpcChainId } from '../protocol/live.ts'

const core = `0x${'34'.repeat(20)}`

describe('trading UI deployment configuration', () => {
	test('rejects an RPC chain that differs from the manifest', () => {
		expect(() => validateRpcChainId(2, 1)).toThrow('RPC chain 2 does not match deployment chain 1')
		expect(validateRpcChainId(1, 1)).toBeUndefined()
	})

	test('loads canonical core deployment choices copied from the root manifests', () => {
		const deployments = parseCoreDeployments([{ chainId: 11_155_111, chainName: 'Sepolia', id: 'sepolia', proxyDeployer: `0x${'45'.repeat(20)}`, securityPoolFactory: core }])
		expect(deployments[0]?.chainId).toBe(11_155_111)
		expect(deployments[0]?.securityPoolFactory.toLowerCase()).toBe(core)
	})

	test('validates user-selected chain, RPC, and fee settings together', () => {
		expect(parseDeploymentSetupInput({ chainId: '11155111', feeBps: '30', rpcUrl: 'https://example.test' })).toEqual({ chainId: 11_155_111, feeBps: 30, rpcUrl: 'https://example.test/' })
		expect(() => parseDeploymentSetupInput({ chainId: '1.5', feeBps: '30', rpcUrl: 'https://example.test' })).toThrow('Chain ID')
		expect(() => parseDeploymentSetupInput({ chainId: '1', feeBps: '10000', rpcUrl: 'https://example.test' })).toThrow('fee')
	})

	test('loads ETH and REP from the selected SecurityPool universe', async () => {
		const account = getAddress(`0x${'45'.repeat(20)}`)
		const pool = getAddress(`0x${'56'.repeat(20)}`)
		const repToken = getAddress(`0x${'67'.repeat(20)}`)
		const contractTargets: string[] = []
		const client = createPublicClient({
			transport: custom({
				request: async ({ method, params }) => {
					if (method === 'eth_getBalance') return '0x3782dace9d900000'
					if (method !== 'eth_call' || !Array.isArray(params)) throw new Error(`Unexpected RPC method: ${method}`)
					const transaction = params[0]
					if (typeof transaction !== 'object' || transaction === null || !('to' in transaction) || typeof transaction.to !== 'string') throw new Error('Expected eth_call target')
					contractTargets.push(transaction.to)
					if (contractTargets.length === 1) return encodeAbiParameters([{ type: 'address' }], [repToken])
					return encodeAbiParameters([{ type: 'uint256' }], [1_750n * 10n ** 18n])
				},
			}),
		})

		const balances = await loadWalletHeaderBalances(client, { pool }, account)

		expect(balances).toEqual({ ethAttoEth: 4n * 10n ** 18n, repAttoRep: 1_750n * 10n ** 18n, repToken })
		expect(contractTargets).toEqual([pool, repToken])
	})
})
