import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { dockerInstructions, parseDockerfile, requireDockerStage, shellCommandSegments } from '../testing/packaging-parsers.ts'

const repositoryRoot = join(import.meta.dir, '..', '..')
const dockerfile = join(repositoryRoot, 'ui', 'Dockerfile')
const dockerignore = join(repositoryRoot, '.dockerignore')
const ipfsDeployWorkflow = join(repositoryRoot, '.github', 'workflows', 'ipfs-deploy.yml')
const versionDeployWorkflow = join(repositoryRoot, '.github', 'workflows', 'version-deploy.yml')
const publisherEntrypoint = join(repositoryRoot, 'tooling', 'ui', 'docker-publisher-entrypoint.sh')
const rootPackage = join(repositoryRoot, 'package.json')
const staticServer = join(repositoryRoot, 'tooling', 'ui', 'dockerServe.mts')

describe('UI Docker packaging', () => {
	test('only copies tracked build inputs and invokes existing UI build scripts', async () => {
		const source = await readFile(dockerfile, 'utf8')
		const stages = parseDockerfile(source)
		const copies = stages.flatMap(stage => dockerInstructions(stage, 'COPY'))
		const runSegments = stages.flatMap(stage => dockerInstructions(stage, 'RUN')).flatMap(shellCommandSegments)
		for (const match of source.matchAll(/^COPY\s+(?!.*--from=)(?:--[^ ]+\s+)*(\.\/\S+)\s+\S+$/gm)) {
			const copiedPath = match[1]
			if (copiedPath === undefined || copiedPath.includes('*')) continue
			const repositoryPath = join(dirname(dockerfile), '..', copiedPath)
			expect(Bun.file(repositoryPath).size > 0 || (await Bun.file(repositoryPath).exists())).toBe(true)
		}
		expect(copies.some(copy => copy.includes('ui/coreShared/tsconfig.vendor.json'))).toBe(false)
		expect(runSegments).not.toContain('bun run vendor')
		expect(runSegments).toEqual(expect.arrayContaining(['bun ./tooling/ui/vendor.mts zoltar', 'bun ./tooling/ui/vendor.mts statoblast']))
		for (const packageId of ['coreShared', 'zoltar', 'statoblast', 'trading']) expect(runSegments).toContain(`bun ./tooling/repo/install-frozen.mts ui/${packageId}`)
		expect(runSegments.some(command => /cd \/source\/ui\/\w+ && bun install/u.test(command))).toBe(false)
		expect(relative(join(dirname(dockerfile), '..'), join(dirname(staticServer)))).toBe('tooling/ui')
	})

	test('builds local runtime images from only the selected application dependency stage', async () => {
		const stages = parseDockerfile(await readFile(dockerfile, 'utf8'))
		const common = requireDockerStage(stages, 'common-builder')
		expect(dockerInstructions(common, 'RUN').flatMap(shellCommandSegments)).toEqual(expect.arrayContaining(['mkdir -p /source/ui/coreShared/ts', 'bun run compile-contracts']))
		for (const appId of ['zoltar', 'statoblast', 'trading']) {
			const builder = requireDockerStage(stages, `${appId}-builder`)
			const runtime = requireDockerStage(stages, `local-runtime-${appId}`)
			expect(dockerInstructions(runtime, 'COPY').some(copy => copy.includes(`--from=${appId}-builder`) && copy.endsWith(`/source/ui/${appId}/dist/ /app/ui/${appId}/`))).toBe(true)
			expect(dockerInstructions(runtime, 'COPY').some(copy => copy.endsWith('./tooling/ui/appPaths.mts /app/tooling/ui/appPaths.mts'))).toBe(true)
			if (appId === 'trading') {
				const instructions = builder.instructions
				expect(instructions.findIndex(instruction => instruction.keyword === 'COPY' && instruction.value === './ui/trading/ts/ /source/ui/trading/ts/')).toBeLessThan(
					instructions.findIndex(instruction => instruction.keyword === 'RUN' && shellCommandSegments(instruction.value).includes('bun ./tooling/ui/vendor.mts trading')),
				)
			}
		}
	})

	test('serves Zoltar and Statoblast on their dedicated container ports', async () => {
		const stages = parseDockerfile(await readFile(dockerfile, 'utf8'))
		for (const [appId, port] of [
			['zoltar', 8012],
			['statoblast', 8011],
		] as const) {
			const stage = requireDockerStage(stages, `local-runtime-${appId}`)
			expect(dockerInstructions(stage, 'EXPOSE')).toContain(port.toString())
			expect(dockerInstructions(stage, 'ENV')).toContain(`PORT=${port}`)
			expect(dockerInstructions(stage, 'HEALTHCHECK').some(value => value.includes(`http://127.0.0.1:${port}/`))).toBe(true)
		}
	})

	test('copies every deployment manifest required by the production build', async () => {
		const common = requireDockerStage(parseDockerfile(await readFile(dockerfile, 'utf8')), 'common-builder')
		expect(dockerInstructions(common, 'COPY')).toEqual(expect.arrayContaining(['./docs/mainnet-deployment-addresses.json /source/docs/mainnet-deployment-addresses.json', './docs/sepolia-deployment-addresses.json /source/docs/sepolia-deployment-addresses.json']))
	})

	test('excludes every split-package generated tree from the Docker source context', async () => {
		const source = await readFile(dockerignore, 'utf8')
		for (const generatedPath of ['ui/*/dist', 'ui/*/js', 'ui/*/vendor', 'ui/*/ts/abis.ts', 'ui/*/ts/contractArtifact.ts', 'ui/*/ts/deploymentArtifacts.ts', 'ui/*/ts/deploymentsArtifacts.ts']) {
			expect(source.split('\n')).toContain(generatedPath)
		}
		expect(source).not.toMatch(/^ui\/(?:dist|js|vendor)$/m)
		expect(source).not.toMatch(/^ui\/ts\//m)
	})

	test('uses a tracked Unix publisher entrypoint instead of a line-ending-sensitive heredoc', async () => {
		const source = await readFile(dockerfile, 'utf8')
		const publisher = requireDockerStage(parseDockerfile(source), 'publisher')
		expect(dockerInstructions(publisher, 'COPY')).toContain('--chmod=755 ./tooling/ui/docker-publisher-entrypoint.sh /entrypoint.sh')
		expect(dockerInstructions(publisher, 'COPY').some(copy => copy.includes("<<'EOF'"))).toBe(false)
		for (const entrypoint of [publisherEntrypoint]) {
			const entrypointSource = await readFile(entrypoint, 'utf8')
			expect(entrypointSource).toStartWith('#!/bin/sh\n')
			expect(entrypointSource).not.toContain('\r')
			const syntaxCheck = Bun.spawn(['sh', '-n', entrypoint], { stderr: 'pipe' })
			expect(await syntaxCheck.exited).toBe(0)
		}
	})

	test('keeps local serving and host IPFS publishing as separate commands', async () => {
		const packageSource = await readFile(rootPackage, 'utf8')
		const publishRunCommand = 'docker run --rm --add-host=host.docker.internal:host-gateway zoltar-ui-publisher'
		expect(packageSource).toContain(`"ui:publish:ipfs": "docker build --target publisher -f ui/Dockerfile . -t zoltar-ui-publisher && ${publishRunCommand}"`)
		expect(packageSource).not.toContain('"ui:docker"')
		const dockerSource = await readFile(dockerfile, 'utf8')
		expect(dockerSource).toContain('AS local-runtime-zoltar')
		expect(dockerSource).toContain('FROM debian:12.6-slim@sha256:39868a6f452462b70cf720a8daff250c63e7342970e749059c105bf7c1e8eeaf AS publisher')
		expect(dockerSource.indexOf('AS local-runtime-zoltar')).toBeLessThan(dockerSource.indexOf('AS publisher'))
		expect(dockerSource).toContain('CMD [ "bun", "/app/tooling/ui/dockerServe.mts" ]')
		expect(await readFile(publisherEntrypoint, 'utf8')).toContain('ipfs add --api "/ip4/$IPFS_IP4_ADDRESS/tcp/5001"')
		const server = await readFile(staticServer, 'utf8')
		expect(server).toContain('http://localhost:${port}/')
		expect(server).not.toContain('ipfs')
	})

	test('keeps the default release image on the final IPFS publisher target', async () => {
		const workflows = await Promise.all([ipfsDeployWorkflow, versionDeployWorkflow].map(path => readFile(path, 'utf8')))
		expect(workflows.every(workflow => workflow.includes('file: ui/Dockerfile'))).toBe(true)
		expect(workflows.every(workflow => !workflow.includes('target: local-runtime'))).toBe(true)
		expect(workflows.some(workflow => workflow.includes('cat /ipfs_hash.txt'))).toBe(true)
		const dockerSource = await readFile(dockerfile, 'utf8')
		expect(dockerSource.lastIndexOf('AS publisher')).toBeGreaterThan(dockerSource.lastIndexOf('AS local-runtime'))
		expect(dockerSource.lastIndexOf('ENTRYPOINT [ "/entrypoint.sh" ]')).toBeGreaterThan(dockerSource.lastIndexOf('CMD [ "bun", "/app/tooling/ui/dockerServe.mts" ]'))
		const stages = dockerSource.split('\n').filter(line => line.startsWith('FROM '))
		expect(stages.at(-1)).toContain(' AS publisher')
	})
})
