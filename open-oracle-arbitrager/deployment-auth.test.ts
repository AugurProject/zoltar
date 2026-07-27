import { describe, expect, test } from 'bun:test'
import { getAddress, keccak256, type Address, type Hex } from '@zoltar/shared/ethereum'
import { authenticateDeploymentManifest, parseDeploymentManifest } from './deployment-auth.js'

const openOracle = getAddress('0x0000000000000000000000000000000000000001')
const executor = getAddress('0x0000000000000000000000000000000000000002')
const openOracleCode = '0x6001' as Hex
const executorCode = '0x6002' as Hex

describe('deployment authentication', () => {
	const manifest = {
		chainId: 1,
		contracts: [
			{ address: openOracle, role: 'open-oracle', runtimeCodeHash: keccak256(openOracleCode) },
			{ address: executor, role: 'executor', runtimeCodeHash: keccak256(executorCode) },
		],
		network: 'mainnet',
		version: 1,
	}

	test('requires exact role, address, and runtime bytecode hash matches', async () => {
		const parsed = parseDeploymentManifest(manifest)
		const code = new Map<string, Hex>([
			[openOracle.toLowerCase(), openOracleCode],
			[executor.toLowerCase(), executorCode],
		])
		await expect(
			authenticateDeploymentManifest(parsed, {
				chainId: 1,
				network: 'mainnet',
				readCode: async (address: Address) => code.get(address.toLowerCase()),
				required: [
					{ address: openOracle, role: 'open-oracle' },
					{ address: executor, role: 'executor' },
				],
			}),
		).resolves.toBeUndefined()
		code.set(executor.toLowerCase(), '0x6003')
		await expect(
			authenticateDeploymentManifest(parsed, {
				chainId: 1,
				network: 'mainnet',
				readCode: async (address: Address) => code.get(address.toLowerCase()),
				required: [{ address: executor, role: 'executor' }],
			}),
		).rejects.toThrow('runtime bytecode hash')
	})

	test('rejects manifests for another chain and duplicate identities', () => {
		expect(() => parseDeploymentManifest({ ...manifest, chainId: 11_155_111 })).not.toThrow()
		expect(() => parseDeploymentManifest({ ...manifest, contracts: [...manifest.contracts, manifest.contracts[0]] })).toThrow('Duplicate deployment identity')
	})
})
