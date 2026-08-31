import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { contractSourceHash } from '../scripts/project-metadata-source.ts'
import { effectiveAbiSourceHash } from '../src/abi-provenance.ts'
import { sourceProvenance } from '../src/provenance.ts'

test('fingerprints the complete effective ABI decoder deterministically', () => {
	const catalog = { Zoltar: { abi: [{ name: 'QuestionCreated', type: 'event' }] } }
	const routing = { zoltar: 'Zoltar' }
	const external = { uniswapV2Pair: [{ name: 'Sync', type: 'event' }] }
	const baseline = effectiveAbiSourceHash(catalog, routing, external)
	expect(baseline).toMatch(/^sha256:[0-9a-f]{64}$/)
	expect(effectiveAbiSourceHash({ ...catalog }, { ...routing }, { ...external })).toBe(baseline)
	expect(effectiveAbiSourceHash({ Zoltar: { abi: [{ name: 'QuestionResolved', type: 'event' }] } }, routing, external)).not.toBe(baseline)
	expect(effectiveAbiSourceHash(catalog, { zoltar: 'OtherZoltar' }, external)).not.toBe(baseline)
	expect(effectiveAbiSourceHash(catalog, routing, { uniswapV2Pair: [{ name: 'Swap', type: 'event' }] })).not.toBe(baseline)
})

test('fingerprints canonical contract sources independently of generated import aliases', () => {
	const sources = {
		'contracts/Zoltar.sol': { content: 'contract Zoltar {}' },
		'contracts/statoblast/OpenOracle.sol': { content: 'contract OpenOracle {}' },
	}
	const baseline = contractSourceHash(sources)
	expect(baseline).toMatch(/^[0-9a-f]{64}$/)
	expect(contractSourceHash({ ...sources, '@openzeppelin/contracts/Token.sol': { content: 'contract Token {}' } })).toBe(baseline)
	expect(contractSourceHash({ ...sources, 'contracts/Zoltar.sol': { content: 'contract Zoltar { uint256 value; }' } })).not.toBe(baseline)
})

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
