import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const dockerfile = join(import.meta.dir, '..', 'ui', 'Dockerfile')
const ipfsDeployWorkflow = join(import.meta.dir, '..', '.github', 'workflows', 'ipfs-deploy.yml')
const publisherEntrypoint = join(import.meta.dir, '..', 'ui', 'scripts', 'docker-entrypoint.sh')
const rootPackage = join(import.meta.dir, '..', 'package.json')
const staticServer = join(import.meta.dir, '..', 'ui', 'build', 'dockerServe.mts')
const windowsLauncher = join(import.meta.dir, '..', 'ui', 'start.bat')

describe('UI Docker packaging', () => {
	test('copies every deployment manifest required by the production build', async () => {
		const source = await readFile(dockerfile, 'utf8')
		expect(source).toContain('COPY ./docs/mainnet-deployment-addresses.json /source/docs/mainnet-deployment-addresses.json')
		expect(source).toContain('COPY ./docs/sepolia-deployment-addresses.json /source/docs/sepolia-deployment-addresses.json')
	})

	test('uses a tracked Unix publisher entrypoint instead of a line-ending-sensitive heredoc', async () => {
		const source = await readFile(dockerfile, 'utf8')
		expect(source).toContain('COPY --chmod=755 ./ui/scripts/docker-entrypoint.sh /entrypoint.sh')
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
		const launcher = (await readFile(windowsLauncher, 'utf8')).replaceAll('\r\n', '\n')
		const packageSource = await readFile(rootPackage, 'utf8')
		const localRunCommand = 'docker run --rm -p 8080:8080 zoltar-ui'
		const publishRunCommand = 'docker run --rm --add-host=host.docker.internal:host-gateway zoltar-ui-publisher'
		expect(launcher).toContain(localRunCommand)
		expect(launcher).toContain('docker build --target local-runtime -f ui/Dockerfile . -t zoltar-ui')
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
		expect(launcher).not.toContain('ipfs')
	})

	test('keeps the default release image on the final IPFS publisher target', async () => {
		const workflow = await readFile(ipfsDeployWorkflow, 'utf8')
		expect(workflow).toContain('file: ui/Dockerfile')
		expect(workflow).not.toContain('target: local-runtime')
		expect(workflow).toContain('cat /ipfs_hash.txt')
		const dockerSource = await readFile(dockerfile, 'utf8')
		expect(dockerSource.lastIndexOf('AS publisher')).toBeGreaterThan(dockerSource.lastIndexOf('AS local-runtime'))
		expect(dockerSource.lastIndexOf('ENTRYPOINT [ "/entrypoint.sh" ]')).toBeGreaterThan(dockerSource.lastIndexOf('CMD [ "bun", "/app/dockerServe.mts" ]'))
	})
})
