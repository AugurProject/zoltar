import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { projectManifests } from '../../scripts/project-manifests.ts'
import { abiForKind, assertAbiCoverage } from '../../src/abi-catalog.ts'
import { discoveredContractKinds } from '../../src/contract-discovery.ts'
import { encodeFunctionData, getAddress, parseAbi, zeroHash } from '../../src/ethereum.ts'
import { parseManifestValue } from '../../src/manifest.ts'
import { decodeAction } from '../../src/metadata.ts'
import { systemInterfaces } from '../../src/system-interfaces.ts'

const root = path.resolve(import.meta.dir, '../..')

test('covers every registered interface and dynamically discovered contract kind', () => {
	expect(() => assertAbiCoverage([...Object.keys(systemInterfaces), ...discoveredContractKinds])).not.toThrow()
	for (const [kind, definition] of Object.entries(systemInterfaces)) {
		if (definition.type === 'raw') expect(definition.reason.length).toBeGreaterThan(0)
		else expect(abiForKind(kind)?.length).toBeGreaterThan(0)
	}
	expect(() => assertAbiCoverage(['futureFactory'])).toThrow('futureFactory')
})

test('routes every contract kind in every shipped network manifest to an ABI', async () => {
	for (const filename of await readdir(path.join(root, 'config/manifests'))) {
		if (!filename.endsWith('.json')) continue
		const manifest = parseManifestValue(await Bun.file(path.join(root, 'config/manifests', filename)).json(), filename)
		for (const [, , kind] of manifest) expect(abiForKind(kind), `${filename}: ${kind}`).toBeDefined()
	}
})

test('decodes USDC transfers with six-decimal token amounts', () => {
	const address = getAddress('0x1111111111111111111111111111111111111111')
	const input = encodeFunctionData({ abi: parseAbi(['function transfer(address to,uint256 value) returns (bool)']), functionName: 'transfer', args: [address, 2_500_000n] })
	const action = decodeAction({ address, label: 'USD Coin', kind: 'usdc', provenance: 'test' }, input, new Map())
	expect(action.status).toBe('decoded')
	expect(action.name).toBe('transfer')
	expect(action.displayArguments?.['value']).toBe('2.5 USDC')
})

test('covers USDC approval, permit and transfer-authorization calls used by the system', () => {
	const address = getAddress('0x1111111111111111111111111111111111111111')
	const calls = [
		{ name: 'approve', signature: 'function approve(address spender,uint256 value) returns (bool)', args: [address, 2_500_000n] },
		{ name: 'permit', signature: 'function permit(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s)', args: [address, address, 2_500_000n, 123n, 27, zeroHash, zeroHash] },
		{ name: 'transferWithAuthorization', signature: 'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)', args: [address, address, 2_500_000n, 0n, 123n, zeroHash, 27, zeroHash, zeroHash] },
		{ name: 'receiveWithAuthorization', signature: 'function receiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)', args: [address, address, 2_500_000n, 0n, 123n, zeroHash, 27, zeroHash, zeroHash] },
	]
	for (const call of calls) {
		const input = encodeFunctionData({ abi: parseAbi([call.signature]), functionName: call.name, args: call.args })
		const action = decodeAction({ address, label: 'USD Coin', kind: 'usdc', provenance: 'test' }, input, new Map())
		expect(action.status).toBe('decoded')
		expect(action.name).toBe(call.name)
		expect(action.arguments?.['value']).toBe('2500000')
		expect(action.displayArguments?.['value']).toBe('2.5 USDC')
	}
})

test('rejects an unsupported manifest contract kind with its source location', () => {
	expect(() => parseManifestValue({ contracts: [['0x1111111111111111111111111111111111111111', 'New factory', 'futureFactory']] }, 'future.json')).toThrow('futureFactory')
})

test('rejects unmapped deployment IDs instead of silently dropping them', async () => {
	const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'augurscan-deployment-coverage-'))
	try {
		await mkdir(path.join(fixtureRoot, 'docs'))
		for (const network of ['mainnet', 'sepolia']) {
			const deployment = await Bun.file(path.join(root, '../docs', `${network}-deployment-addresses.json`)).json()
			deployment.deploymentSteps.push({ id: 'futureFactory', label: 'New factory', address: '0x1111111111111111111111111111111111111111' })
			await Bun.write(path.join(fixtureRoot, 'docs', `${network}-deployment-addresses.json`), JSON.stringify(deployment))
		}
		await expect(projectManifests(fixtureRoot)).rejects.toThrow('futureFactory')
	} finally {
		await rm(fixtureRoot, { recursive: true, force: true })
	}
})
