import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

const dockerfile = join(import.meta.dir, '..', 'ui', 'Dockerfile')
const dockerignore = join(import.meta.dir, '..', '.dockerignore')
const ipfsDeployWorkflow = join(import.meta.dir, '..', '.github', 'workflows', 'ipfs-deploy.yml')
const versionDeployWorkflow = join(import.meta.dir, '..', '.github', 'workflows', 'version-deploy.yml')
const publisherEntrypoint = join(import.meta.dir, '..', 'ui', 'coreShared', 'scripts', 'docker-entrypoint.sh')
const rootPackage = join(import.meta.dir, '..', 'package.json')
const staticServer = join(import.meta.dir, '..', 'ui', 'coreShared', 'build', 'dockerServe.mts')

describe('UI Docker packaging', () => {
	test('only copies tracked build inputs and invokes existing UI build scripts', async () => {
		const source = await readFile(dockerfile, 'utf8')
		for (const match of source.matchAll(/^COPY\s+(?!.*--from=)(?:--[^ ]+\s+)*(\.\/\S+)\s+\S+$/gm)) {
			const copiedPath = match[1]
			if (copiedPath === undefined || copiedPath.includes('*')) continue
			const repositoryPath = join(dirname(dockerfile), '..', copiedPath)
			expect(Bun.file(repositoryPath).size > 0 || (await Bun.file(repositoryPath).exists())).toBe(true)
		}
		expect(source).not.toContain('ui/coreShared/tsconfig.vendor.json')
		expect(source).not.toContain('bun run vendor')
		expect(source).toContain('bun ./ui/coreShared/build/vendor.mts zoltar && bun ./ui/coreShared/build/vendor.mts statoblast')
		for (const packageId of ['coreShared', 'zoltar', 'statoblast', 'trading']) expect(source).toContain(`bun ./scripts/install-frozen.mts ui/${packageId}`)
		expect(source).not.toMatch(/cd \/source\/ui\/\w+ && bun install/)
		expect(relative(join(dirname(dockerfile), '..'), join(dirname(staticServer)))).toBe('ui/coreShared/build')
	})

	test('copies every deployment manifest required by the production build', async () => {
		const source = await readFile(dockerfile, 'utf8')
		expect(source).toContain('COPY ./docs/mainnet-deployment-addresses.json /source/docs/mainnet-deployment-addresses.json')
		expect(source).toContain('COPY ./docs/sepolia-deployment-addresses.json /source/docs/sepolia-deployment-addresses.json')
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
		expect(source).toContain('COPY --chmod=755 ./ui/coreShared/scripts/docker-entrypoint.sh /entrypoint.sh')
		expect(source).not.toContain("COPY <<'EOF' /entrypoint.sh")
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
		expect(dockerSource).toContain('FROM oven/bun:${BUN_VERSION}-alpine AS local-runtime')
		expect(dockerSource).toContain('FROM debian:12.6-slim@sha256:39868a6f452462b70cf720a8daff250c63e7342970e749059c105bf7c1e8eeaf AS publisher')
		expect(dockerSource.indexOf('AS local-runtime')).toBeLessThan(dockerSource.indexOf('AS publisher'))
		expect(dockerSource).toContain('CMD [ "bun", "/app/dockerServe.mts" ]')
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
		expect(dockerSource.lastIndexOf('ENTRYPOINT [ "/entrypoint.sh" ]')).toBeGreaterThan(dockerSource.lastIndexOf('CMD [ "bun", "/app/dockerServe.mts" ]'))
		const stages = dockerSource.split('\n').filter(line => line.startsWith('FROM '))
		expect(stages.at(-1)).toContain(' AS publisher')
	})
})
