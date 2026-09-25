import { describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { dockerInstructions, parseDockerfile, requireDockerStage } from '../../../tooling/testing/packaging-parsers.ts'
import { augurScanMetadataOutputs } from '../../../tooling/repo/projects.ts'

const windowsLauncher = join(import.meta.dir, '..', '..', 'start.bat')
const rootDockerIgnore = join(import.meta.dir, '..', '..', '..', '.dockerignore')
const dockerfile = join(import.meta.dir, '..', '..', 'Dockerfile')
const composeFile = join(import.meta.dir, '..', '..', 'compose.yaml')
const readmeFile = join(import.meta.dir, '..', '..', 'README.md')
const schemaFile = join(import.meta.dir, '..', '..', 'schema.sql')
const rootGitIgnore = join(import.meta.dir, '..', '..', '..', '.gitignore')

describe('Docker packaging', () => {
	test('builds the browser bundle from only the image source copies', async () => {
		const repositoryRoot = join(import.meta.dir, '..', '..', '..')
		const stages = parseDockerfile(await readFile(dockerfile, 'utf8'))
		const workspace = await mkdtemp(join(tmpdir(), 'augurscan-browser-'))
		try {
			let cwd = workspace
			for (const stageName of ['workspace', 'browser-build']) {
				for (const instruction of requireDockerStage(stages, stageName).instructions) {
					if (instruction.keyword === 'WORKDIR') {
						cwd = join(workspace, relative('/workspace', instruction.value))
						await mkdir(cwd, { recursive: true })
					} else if (instruction.keyword === 'COPY') {
						const parts = instruction.value.split(/\s+/u)
						const destination = parts.pop()
						if (destination === undefined || parts.length === 0) throw new Error(`Invalid browser COPY: ${instruction.value}`)
						for (const source of parts) {
							const target = join(cwd, destination, destination.endsWith('/') ? basename(source) : '')
							await mkdir(dirname(target), { recursive: true })
							await cp(join(repositoryRoot, source), target, { recursive: true })
						}
					} else if (instruction.keyword === 'RUN') {
						const command = instruction.value.split(/\s+/u)
						// Use the cache populated by repository setup, without network access
						// or links to local workspace sources and generated output.
						if (instruction.value.startsWith('bun install ')) command.push('--offline')
						const build = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
						const [status, output, errors] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()])
						expect(status, `${instruction.value}\n${output}\n${errors}`).toBe(0)
					}
				}
			}
			expect((await readFile(join(workspace, 'augurScan/public/app.js'), 'utf8')).length).toBeGreaterThan(0)
		} finally {
			await rm(workspace, { recursive: true, force: true })
		}
	}, 120_000)

	test('loads shared helper consumers from the runtime image source copies', async () => {
		const repositoryRoot = join(import.meta.dir, '..', '..', '..')
		const stages = parseDockerfile(await readFile(dockerfile, 'utf8'))
		const runtime = requireDockerStage(stages, 'runtime')
		const metadataBuild = requireDockerStage(stages, 'metadata-build')
		const workspace = await mkdtemp(join(tmpdir(), 'augurscan-runtime-'))
		const buildWorkspace = await mkdtemp(join(tmpdir(), 'augurscan-image-metadata-'))
		try {
			for (const copy of dockerInstructions(metadataBuild, 'COPY')) {
				const [source, destination] = copy.split(/\s+/u)
				if (source === undefined || destination === undefined) throw new Error(`Invalid metadata source COPY: ${copy}`)
				await mkdir(dirname(join(buildWorkspace, destination)), { recursive: true })
				await cp(join(repositoryRoot, source), join(buildWorkspace, destination), { recursive: true })
			}
			// Reuse verified compiler caches, as CI does. Scanner routes
			// and manifests must be produced by the actual image build command.
			for (const source of ['augurScan/package.json', 'solidity/.contract-hash.json', 'solidity/artifacts/Contracts.json']) {
				await mkdir(dirname(join(buildWorkspace, source)), { recursive: true })
				await cp(join(repositoryRoot, source), join(buildWorkspace, source))
			}
			for (const directory of ['node_modules', 'solidity/node_modules']) await symlink(join(repositoryRoot, directory), join(buildWorkspace, directory), 'dir')
			const buildCommand = dockerInstructions(metadataBuild, 'RUN').find(command => command.includes('metadata:build'))
			if (buildCommand === undefined) throw new Error('Runtime metadata has no Docker build command')
			const build = Bun.spawn(buildCommand.split(/\s+/u), { cwd: buildWorkspace, stdout: 'pipe', stderr: 'pipe' })
			const [buildStatus, buildOutput, buildErrors] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()])
			expect(buildStatus, `${buildOutput}\n${buildErrors}`).toBe(0)
			for (const copy of dockerInstructions(runtime, 'COPY').filter(value => value.startsWith('shared/') || value.startsWith('augurScan/src ') || value.startsWith('augurScan/config ') || value.startsWith('augurScan/scripts/') || value.startsWith('--from=metadata-build '))) {
				if (copy.startsWith('--from=metadata-build ')) {
					const [, source, destination] = copy.split(/\s+/u)
					if (source === undefined || destination === undefined) throw new Error(`Invalid generated metadata COPY: ${copy}`)
					await cp(join(buildWorkspace, source.replace('/workspace/', '')), join(workspace, destination), { recursive: true })
					continue
				}
				const [source, destination] = copy.split(/\s+/u)
				if (source === undefined || destination === undefined) throw new Error(`Invalid runtime source COPY: ${copy}`)
				const target = join(workspace, destination, source.endsWith('.json') && destination.endsWith('/') ? basename(source) : '')
				await mkdir(dirname(target), { recursive: true })
				await cp(join(repositoryRoot, source), target, { recursive: true, filter: file => !augurScanMetadataOutputs.includes(relative(repositoryRoot, file)) })
			}
			await symlink(join(repositoryRoot, 'node_modules'), join(workspace, 'node_modules'), 'dir')
			await symlink(join(repositoryRoot, 'shared/core/node_modules'), join(workspace, 'shared/core/node_modules'), 'dir')
			const result = Bun.spawnSync([process.execPath, '-e', "for (const source of ['ethereum', 'operations', 'error-chain', 'rpc-request-queue', 'indexer/ownership-status']) await import('./augurScan/src/' + source + '.ts')"], { cwd: workspace, stdout: 'pipe', stderr: 'pipe' })
			expect(result.stderr.toString()).toBe('')
			expect(result.exitCode).toBe(0)
			const report = Bun.spawnSync([process.execPath, 'augurScan/scripts/report-abi-coverage.ts', '--help'], { cwd: workspace, stdout: 'pipe', stderr: 'pipe' })
			expect(report.stderr.toString()).toBe('')
			expect(report.exitCode).toBe(0)
			expect(report.stdout.toString()).toContain('metadata:unknown-calls')
		} finally {
			await rm(workspace, { recursive: true, force: true })
			await rm(buildWorkspace, { recursive: true, force: true })
		}
	}, 120_000)

	test('provides a location-independent Windows launcher', async () => {
		const source = (await readFile(windowsLauncher, 'utf8')).replaceAll('\r\n', '\n')
		expect(source).toContain('pushd "%~dp0"')
		expect(source).toContain('docker compose stop || goto finish\ndocker compose build || goto finish\ndocker compose up --no-build --force-recreate\n:finish\nset "exit_code=%errorlevel%"\npopd\npause\nexit /b %exit_code%')
	})

	test('excludes local environment secrets from the repository build context', async () => {
		const patterns = (await readFile(rootDockerIgnore, 'utf8')).split(/\r?\n/u)
		expect(patterns).toContain('**/.env')
		expect(patterns).toContain('**/.env.*')
		expect(patterns).toContain('!**/.env.example')
	})

	test('builds browser TypeScript outside the final runtime image', async () => {
		const source = await readFile(dockerfile, 'utf8')
		expect(source).toContain('FROM workspace AS browser-build')
		expect(source).toContain('COPY augurScan/browser ./browser')
		expect(source).toContain('RUN bun run build:browser')
		const runtimeStage = source.slice(source.indexOf('FROM oven/bun:${BUN_VERSION}-alpine AS runtime'))
		expect(runtimeStage).toContain('COPY --from=browser-build /workspace/augurScan/public ./augurScan/public')
		expect(runtimeStage).toContain('COPY augurScan/schema.sql ./augurScan/schema.sql')
		expect(runtimeStage).toContain('COPY augurScan/migrations ./augurScan/migrations')
		expect(runtimeStage).not.toContain('COPY augurScan/browser')
		expect(runtimeStage).not.toContain('COPY --from=browser-build /workspace/augurScan/node_modules')
	})

	test('packages source-provenance inputs beside the runtime server', async () => {
		const source = await readFile(dockerfile, 'utf8')
		const runtimeStage = source.slice(source.indexOf('FROM oven/bun:${BUN_VERSION}-alpine AS runtime'))
		expect(runtimeStage).toContain('COPY augurScan/package.json ./augurScan/')
		expect(runtimeStage).toContain('COPY augurScan/scripts/verify-compose-source.ts ./augurScan/scripts/verify-compose-source.ts')
		expect(runtimeStage).toContain('COPY augurScan/scripts/verify-export-page.ts ./augurScan/scripts/verify-export-page.ts')
		expect(runtimeStage).not.toContain('COPY augurScan/package.json augurScan/bun.lock ./\n')
	})

	test('persists the rotating RPC exchange log in a dedicated writable volume', async () => {
		const dockerfileSource = await readFile(dockerfile, 'utf8')
		const composeSource = await readFile(composeFile, 'utf8')
		const gitIgnorePatterns = (await readFile(rootGitIgnore, 'utf8')).split(/\r?\n/u)
		expect(dockerfileSource).toContain('mkdir -p /workspace/augurScan/logs /var/log/augurscan && chown -R bun:bun /workspace/augurScan/logs /var/log/augurscan')
		expect(composeSource).toContain('RPC_LOG_PATH: /var/log/augurscan/rpc.jsonl')
		expect(composeSource).toContain('augurscan-logs:/var/log/augurscan')
		expect(composeSource).toContain('indexer:')
		expect(composeSource).toContain('augurscan-logs:')
		expect(gitIgnorePatterns).toContain('/augurScan/logs/')
	})

	test('runs the web app separately from the indexer in Compose', async () => {
		const source = await readFile(composeFile, 'utf8')
		expect(source).toContain(`POSTGRES_URL: \${POSTGRES_URL:-postgres://augurscan:\${POSTGRES_PASSWORD:-augurscan-local}@postgres:5432/augurscan}`)
		expect(source).toContain('DISABLE_INDEXER: 1')
		expect(source).toContain('command: ["bun", "augurScan/src/indexer-process.ts"]')
		expect(source).toContain(`DISABLE_INDEXER: \${DISABLE_INDEXER:-0}`)
		expect(source).toContain(`LOG_SCAN_RANGE_SIZE: \${LOG_SCAN_RANGE_SIZE:-100000}`)
	})

	test('runs the PostgreSQL build used to generate the authoritative schema', async () => {
		const composeSource = await readFile(composeFile, 'utf8')
		const readmeSource = await readFile(readmeFile, 'utf8')
		const schemaSource = await readFile(schemaFile, 'utf8')
		const schemaVersion = /Dumped from database version (\d+\.\d+)/u.exec(schemaSource)?.[1]
		if (schemaVersion === undefined) throw new Error('The authoritative schema must record its PostgreSQL server release')
		const image = `postgres:${schemaVersion}-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`
		expect(schemaSource).toContain(`Dumped from database version ${schemaVersion} (Debian ${schemaVersion}-1.pgdg12+2)`)
		expect(composeSource).toContain(`image: ${image}`)
		expect(readmeSource).toContain(image)
	})
})
