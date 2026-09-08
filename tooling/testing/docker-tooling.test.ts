import { describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { dockerInstructions, parseDockerfile, requireDockerStage } from './packaging-parsers.ts'

const repositoryRoot = join(import.meta.dir, '..', '..')
const dockerfile = join(repositoryRoot, 'ui', 'Dockerfile')

async function copyToolingInput(copy: string, root: string) {
	const parts = copy.split(' ').filter(part => !part.startsWith('--'))
	const [source, destination] = parts
	if (!source?.replace(/^\.\//u, '').startsWith('tooling/') || destination === undefined) return
	const target = join(root, destination.startsWith('/') ? destination : `/source/${destination}`)
	await mkdir(dirname(target), { recursive: true })
	await cp(join(repositoryRoot, source), target, { recursive: true })
}

async function expectToolImports(root: string, entrypoint: string) {
	const result = await Bun.build({ entrypoints: [join(root, entrypoint)], target: 'bun' })
	expect(result.logs.map(log => log.message)).toEqual([])
	expect(result.success).toBe(true)
}

describe('Docker tooling dependencies', () => {
	// Resolve the actual tool imports using only files available at each Docker layer.
	// Host checkout files must not mask missing COPY inputs.
	for (const [dockerfilePath, stageName] of [
		['ui/Dockerfile', 'common-builder'],
		['bots/chaos/Dockerfile', 'shared-builder'],
		['bots/liquidator/Dockerfile', 'shared-builder'],
		['bots/open-oracle-arbitrager/Dockerfile', 'shared-builder'],
	] as const) {
		test(`${dockerfilePath} copies build tooling before the commands that import it`, async () => {
			const common = requireDockerStage(parseDockerfile(await readFile(join(repositoryRoot, dockerfilePath), 'utf8')), stageName)
			if (dockerfilePath.startsWith('bots/')) {
				const ignore = await readFile(join(repositoryRoot, `${dockerfilePath}.dockerignore`), 'utf8')
				expect(ignore.split(/\r?\n/u)).toEqual(expect.arrayContaining(['!tooling/', '!tooling/**']))
			}
			const root = await mkdtemp(join(tmpdir(), 'docker-build-tooling-'))
			try {
				for (const instruction of common.instructions) {
					if (instruction.keyword === 'COPY') await copyToolingInput(instruction.value, root)
					if (instruction.keyword !== 'RUN') continue
					if (instruction.value.includes('bun install')) await expectToolImports(root, '/source/tooling/repo/link-shared-node-modules.mts')
					if (instruction.value.includes('bun run shared:build')) await expectToolImports(root, '/source/tooling/contracts/ensure-contract-artifacts.mts')
					if (instruction.value.includes('bun run compile-contracts')) {
						await expectToolImports(root, '/source/tooling/repo/ensure-shared-package-fresh.mts')
						await expectToolImports(root, '/source/tooling/ui/projectArtifacts.mts')
					}
					if (instruction.value.includes('install-frozen.mts')) await expectToolImports(root, '/source/tooling/repo/install-frozen.mts')
				}
			} finally {
				await rm(root, { recursive: true, force: true })
			}
		})
	}
	for (const appId of ['zoltar', 'statoblast', 'trading']) {
		test(`${appId} runtime includes the server's transitive imports`, async () => {
			const stage = requireDockerStage(parseDockerfile(await readFile(dockerfile, 'utf8')), `local-runtime-${appId}`)
			const root = await mkdtemp(join(tmpdir(), 'ui-docker-runtime-'))
			try {
				for (const copy of dockerInstructions(stage, 'COPY')) await copyToolingInput(copy, root)
				const command: unknown = JSON.parse(dockerInstructions(stage, 'CMD')[0] ?? '[]')
				if (!Array.isArray(command) || typeof command[1] !== 'string') throw new Error('Expected a Bun server entrypoint')
				await expectToolImports(root, command[1])
			} finally {
				await rm(root, { recursive: true, force: true })
			}
		})
	}
})
