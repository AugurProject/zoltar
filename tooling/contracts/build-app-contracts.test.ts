import { expect, test } from 'bun:test'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { repositoryRoot } from '../repo/root.mts'
import { UI_APP_IDS } from '../ui/appIds.mts'

for (const app of UI_APP_IDS) {
	test(`${app} contract build exports canonical deployment bytecode from the shared compiler cache`, async () => {
		const fixtureRoot = fs.mkdtempSync(path.join(tmpdir(), 'app-contract-build-'))
		const writeFixture = (filename: string, content: string) => {
			const destination = path.join(fixtureRoot, filename)
			fs.mkdirSync(path.dirname(destination), { recursive: true })
			fs.writeFileSync(destination, content)
		}
		try {
			for (const source of ['tooling/contracts/build-app-contracts.mts', 'tooling/ui/projectArtifacts.mts', 'tooling/ui/appPaths.mts', 'tooling/ui/appIds.mts', 'tooling/repo/root.mts', 'tooling/repo/projects.ts', 'tooling/repo/sharedPackages.ts', 'solidity/ts/contractProjects.ts']) {
				writeFixture(source, fs.readFileSync(path.join(repositoryRoot, source), 'utf8'))
			}
			writeFixture('solidity/ts/compile.ts', "await Bun.write('compiler-arguments.json', JSON.stringify(process.argv.slice(2)))\n")
			writeFixture('solidity/ts/abi/abis.ts', 'export const abis = {}\n')
			fs.mkdirSync(path.join(fixtureRoot, 'ui/coreShared/ts'), { recursive: true })
			const compiledContracts = (bytecode: string) =>
				JSON.stringify({
					contracts: Object.fromEntries(['contracts/Zoltar.sol', 'contracts/statoblast/SecurityPool.sol', 'contracts/trading/Router.sol'].map(filename => [filename, { Fixture: { abi: [], evm: { bytecode: { object: bytecode } } } }])),
				})
			writeFixture('solidity/artifacts/Contracts.json', compiledContracts('60006001'))
			// Reduced compiler source sets can produce different deployment bytecode.
			for (const project of ['zoltar', 'statoblast', 'trading']) writeFixture(`solidity/artifacts/${project}/Contracts.json`, compiledContracts('60006002'))

			const child = Bun.spawn([process.execPath, './tooling/contracts/build-app-contracts.mts', app], { cwd: fixtureRoot, stdout: 'pipe', stderr: 'pipe' })
			const [exitCode, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
			expect({ exitCode, output, errors }).toEqual({ exitCode: 0, output: '', errors: '' })
			const outputPaths = ['ui/coreShared/ts/contractArtifact.ts']
			if (app !== 'zoltar') outputPaths.push('ui/statoblastShared/ts/contractArtifact.ts')
			if (app === 'trading') outputPaths.push('ui/trading/ts/generated/contractArtifact.ts')
			for (const outputPath of outputPaths) {
				const artifact = fs.readFileSync(path.join(fixtureRoot, outputPath), 'utf8')
				expect(artifact).toContain('60006001')
				expect(artifact).not.toContain('60006002')
			}
			expect(JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'solidity/compiler-arguments.json'), 'utf8'))).toEqual([])
		} finally {
			fs.rmSync(fixtureRoot, { recursive: true, force: true })
		}
	})
}
