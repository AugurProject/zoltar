import { describe, expect, test } from 'bun:test'
import { getAddress, keccak256, type Address, type Hex } from '#ethereum'
import { authenticateDeploymentManifest, createDeploymentManifest, parseDeploymentManifest, parseDeploymentRole, verifyDeploymentManifest, type DeploymentManifest } from '#config/deployment-auth'
import { requireManifestAuthenticationQuorum } from '#config/runtime-deployment'

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

	test('rejects manifest configuration mismatches before reading RPC code', async () => {
		let codeReads = 0
		const readCode = async () => {
			codeReads += 1
			return openOracleCode
		}
		for (const authentication of [
			authenticateDeploymentManifest(manifest, { chainId: 11_155_111, network: 'sepolia', readCode, required: [{ address: openOracle, role: 'open-oracle' }] }),
			authenticateDeploymentManifest(manifest, { chainId: 1, network: 'mainnet', readCode, required: [{ address: getAddress('0x0000000000000000000000000000000000000003'), role: 'token' }] }),
		]) {
			try {
				await authentication
				throw new Error('Expected deployment authentication to fail')
			} catch (error) {
				expect(error instanceof Error ? error.message : String(error)).not.toContain('RPC ')
			}
		}
		expect(codeReads).toBe(0)
	})

	test('recognizes the separately authenticated Uniswap execution roles', () => {
		expect(parseDeploymentRole('uniswap-v2-router')).toBe('uniswap-v2-router')
		expect(parseDeploymentRole('uniswap-v4-pool-manager')).toBe('uniswap-v4-pool-manager')
		expect(parseDeploymentRole('uniswap-v4-quoter')).toBe('uniswap-v4-quoter')
	})

	test('tolerates one unavailable manifest reader but never a safety mismatch under the explicit quorum policy', async () => {
		const previous = process.env['ZOLTAR_BOT_RPC_QUORUM']
		try {
			process.env['ZOLTAR_BOT_RPC_QUORUM'] = '2'
			await expect(requireManifestAuthenticationQuorum([Promise.resolve(), Promise.resolve(), Promise.reject(new TypeError('fetch failed'))])).resolves.toBeUndefined()
			await expect(requireManifestAuthenticationQuorum([Promise.resolve(), Promise.reject(new TypeError('fetch failed')), Promise.reject(new TypeError('fetch failed'))])).rejects.toThrow('at least two available independent RPC endpoints')
			await expect(requireManifestAuthenticationQuorum([Promise.resolve(), Promise.resolve(), Promise.reject(new Error('runtime bytecode hash mismatch'))])).rejects.toThrow('runtime bytecode hash mismatch')
		} finally {
			if (previous === undefined) delete process.env['ZOLTAR_BOT_RPC_QUORUM']
			else process.env['ZOLTAR_BOT_RPC_QUORUM'] = previous
		}
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
