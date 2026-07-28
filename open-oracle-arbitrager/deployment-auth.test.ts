import { describe, expect, test } from 'bun:test'
import { getAddress, keccak256, type Address, type Hex } from '@zoltar/shared/ethereum'
import { authenticateDeploymentManifest, createDeploymentManifest, parseDeploymentManifest, verifyDeploymentManifest, type DeploymentManifest } from './deployment-auth.js'

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
	} satisfies DeploymentManifest

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
		expect(() => parseDeploymentManifest({ ...manifest, chainId: 11_155_111 })).toThrow('mainnet requires chainId 1')
		expect(() => parseDeploymentManifest({ ...manifest, chainId: 1, network: 'sepolia' })).toThrow('sepolia requires chainId 11155111')
		expect(() => parseDeploymentManifest({ ...manifest, contracts: [...manifest.contracts, manifest.contracts[0]] })).toThrow('Duplicate deployment identity')
		expect(() => parseDeploymentManifest({ ...manifest, unexpected: true })).toThrow('unsupported fields')
		expect(() =>
			parseDeploymentManifest({
				...manifest,
				contracts: [...manifest.contracts, { ...manifest.contracts[1], address: '0x0000000000000000000000000000000000000003' }],
			}),
		).toThrow('multiple executor')
	})

	test('generates and independently verifies every runtime bytecode hash', async () => {
		const code = new Map<string, Hex>([
			[openOracle.toLowerCase(), openOracleCode],
			[executor.toLowerCase(), executorCode],
		])
		const generated = await createDeploymentManifest(
			'mainnet',
			1,
			[
				{ address: openOracle, role: 'open-oracle' },
				{ address: executor, role: 'executor' },
			],
			async address => code.get(address.toLowerCase()),
		)
		expect(generated.contracts).toEqual(manifest.contracts)
		await expect(verifyDeploymentManifest(generated, async address => code.get(address.toLowerCase()))).resolves.toBeUndefined()
		code.set(openOracle.toLowerCase(), '0x6004')
		await expect(verifyDeploymentManifest(generated, async address => code.get(address.toLowerCase()))).rejects.toThrow('runtime bytecode hash')
	})
})
