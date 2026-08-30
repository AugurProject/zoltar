import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sourceProvenance } from '../src/provenance.ts'

test('changes the application hash when a shared runtime dependency changes', async () => {
	const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'augurscan-provenance-'))
	const projectRoot = path.join(repositoryRoot, 'augurScan')
	const sharedSource = path.join(repositoryRoot, 'shared/ts/ethereum.ts')
	try {
		await mkdir(path.join(projectRoot, 'src'), { recursive: true })
		await mkdir(path.dirname(sharedSource), { recursive: true })
		await Promise.all([
			writeFile(path.join(projectRoot, 'package.json'), '{}'),
			writeFile(path.join(projectRoot, 'bun.lock'), ''),
			writeFile(path.join(projectRoot, 'src/ethereum.ts'), "export {\n\tdecoderVersion,\n} from '../../shared/ts/ethereum.ts'\n"),
			writeFile(path.join(projectRoot, 'src/operations.ts'), "export const operation = 'stable'\n"),
			writeFile(path.join(projectRoot, 'src/projections.ts'), "export const projection = 'stable'\n"),
			writeFile(sharedSource, "export const decoderVersion = 'one'\n"),
		])
		const before = await sourceProvenance(projectRoot)
		await writeFile(sharedSource, "export const decoderVersion = 'two'\n")
		const after = await sourceProvenance(projectRoot)

		expect(after.applicationSourceHash).not.toBe(before.applicationSourceHash)
		expect(after.projectionSourceHash).toBe(before.projectionSourceHash)
	} finally {
		await rm(repositoryRoot, { recursive: true, force: true })
	}
})
