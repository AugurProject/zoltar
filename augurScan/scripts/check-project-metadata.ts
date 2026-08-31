import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')
const generatedRoot = await mkdtemp(path.join(tmpdir(), 'augurscan-metadata-'))

try {
	const generation = Bun.spawn(['bun', 'scripts/snapshot-project-metadata.ts', '--output-root', generatedRoot], {
		cwd: projectRoot,
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [exitCode, stdout, stderr] = await Promise.all([generation.exited, new Response(generation.stdout).text(), new Response(generation.stderr).text()])
	if (exitCode !== 0) throw new Error(`Unable to generate augurScan metadata for comparison\n${stderr || stdout}`)
	const stale: string[] = []
	for (const relativePath of ['abis.json']) {
		const [expected, current] = await Promise.all([
			readFile(path.join(generatedRoot, relativePath), 'utf8'),
			readFile(path.join(projectRoot, 'config', relativePath), 'utf8'),
		])
		if (expected !== current) stale.push(`config/${relativePath}`)
	}
	if (stale.length > 0) throw new Error(`Generated augurScan metadata is stale: ${stale.join(', ')}. Run bun run metadata:snapshot.`)
	process.stdout.write('Generated augurScan metadata is current.\n')
} finally {
	await rm(generatedRoot, { recursive: true, force: true })
}
