import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import dependencyAbis from '../../config/dependency-abis.json'
import { ensureDependencyAbis } from '../../scripts/dependency-abis.ts'

test('reuses verified ABI caches offline and rejects unverified replacements for stale caches', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'augurscan-abi-cache-'))
	const output = path.join(directory, 'dependency-abis.json')
	let requests = 0
	const fetchArtifact = async () => {
		requests++
		return new Response('{"abi":[]}')
	}
	try {
		await Bun.write(output, JSON.stringify(dependencyAbis))
		await ensureDependencyAbis(output, fetchArtifact)
		expect(requests).toBe(0)
		await Bun.write(output, '{}')
		await expect(ensureDependencyAbis(output, fetchArtifact)).rejects.toThrow('artifact checksum mismatch')
		expect(requests).toBe(1)
		expect(await Bun.file(output).text()).toBe('{}')
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('builds scanner metadata from source with verified compiler and dependency caches', async () => {
	const repositoryRoot = path.resolve(import.meta.dir, '../../..')
	const workspace = await mkdtemp(path.join(tmpdir(), 'augurscan-source-build-'))
	try {
		for (const relative of [
			'package.json',
			'augurScan/package.json',
			'augurScan/browser',
			'augurScan/public',
			'augurScan/scripts',
			'augurScan/src',
			'augurScan/config/networks.json',
			'augurScan/config/dependency-abi-sources.json',
			'augurScan/config/dependency-abis.json',
			'solidity/contracts',
			'solidity/ts/compile.ts',
			'solidity/ts/contractProjects.ts',
			'solidity/.contract-hash.json',
			'solidity/artifacts/Contracts.json',
			'docs/mainnet-deployment-addresses.json',
			'docs/sepolia-deployment-addresses.json',
			'shared/core/ts',
		]) {
			const destination = path.join(workspace, relative)
			await mkdir(path.dirname(destination), { recursive: true })
			await cp(path.join(repositoryRoot, relative), destination, { recursive: true })
		}
		for (const directory of ['node_modules', 'solidity/node_modules', 'shared/core/node_modules']) await symlink(path.join(repositoryRoot, directory), path.join(workspace, directory), 'dir')
		const build = Bun.spawn([process.execPath, 'run', 'build'], { cwd: path.join(workspace, 'augurScan'), stdout: 'pipe', stderr: 'pipe' })
		const [status, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()])
		expect(status, `${stdout}\n${stderr}`).toBe(0)
		for (const output of ['abis.json', 'system-contracts.generated.ts', 'dependency-abis.json', 'manifests/mainnet.json', 'manifests/sepolia.json']) expect(await Bun.file(path.join(workspace, 'augurScan/config', output)).exists(), output).toBe(true)
		const decoder = Bun.spawn([process.execPath, '-e', "const {abiForKind}=await import('./src/abi-catalog.ts'); if(!abiForKind('delegationManager')?.some(item=>item.name==='redeemDelegations') || !abiForKind('securityPool')?.length) process.exit(1)"], {
			cwd: path.join(workspace, 'augurScan'),
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const [decoderStatus, decoderError] = await Promise.all([decoder.exited, new Response(decoder.stderr).text()])
		expect(decoderStatus, decoderError).toBe(0)
	} finally {
		await rm(workspace, { recursive: true, force: true })
	}
}, 120_000)
