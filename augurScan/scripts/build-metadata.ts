import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { verifyDependencyAbiFile } from './dependency-abis.ts'

const projectRoot = path.resolve(import.meta.dir, '..')
const repositoryRoot = path.resolve(projectRoot, '..')

async function run(command: readonly string[], cwd: string): Promise<void> {
	const child = Bun.spawn([process.execPath, ...command], { cwd, stdout: 'inherit', stderr: 'inherit' })
	if ((await child.exited) !== 0) throw new Error(`Metadata build failed: bun ${command.join(' ')}`)
}

export async function buildMetadata(): Promise<void> {
	// The component workflow builds metadata once on its checkout before running these commands.
	if (process.env['ZOLTAR_AUGUR_SCAN_METADATA_CURRENT'] === '1') return
	await verifyDependencyAbiFile(path.join(projectRoot, 'config/dependency-abis.json'))
	await mkdir(path.join(repositoryRoot, 'solidity/ts/types'), { recursive: true })
	await run(['ts/compile.ts'], path.join(repositoryRoot, 'solidity'))
	await run(['scripts/snapshot-project-metadata.ts'], projectRoot)
}

if (import.meta.main) await buildMetadata()
