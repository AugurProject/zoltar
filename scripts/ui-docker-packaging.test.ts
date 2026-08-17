import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const dockerfile = join(import.meta.dir, '..', 'ui', 'Dockerfile')
const publisherEntrypoint = join(import.meta.dir, '..', 'ui', 'scripts', 'docker-entrypoint.sh')
const rootPackage = join(import.meta.dir, '..', 'package.json')
const serverEntrypoint = join(import.meta.dir, '..', 'ui', 'scripts', 'docker-serve-ui.sh')
const windowsLauncher = join(import.meta.dir, '..', 'ui', 'start.bat')

describe('UI Docker packaging', () => {
	test('copies every deployment manifest required by the production build', async () => {
		const source = await readFile(dockerfile, 'utf8')
		expect(source).toContain('COPY ./docs/mainnet-deployment-addresses.json /source/docs/mainnet-deployment-addresses.json')
		expect(source).toContain('COPY ./docs/sepolia-deployment-addresses.json /source/docs/sepolia-deployment-addresses.json')
	})

	test('uses tracked Unix entrypoints instead of a line-ending-sensitive heredoc', async () => {
		const source = await readFile(dockerfile, 'utf8')
		expect(source).toContain('COPY --chmod=755 ./ui/scripts/docker-entrypoint.sh /entrypoint.sh')
		expect(source).toContain('COPY --chmod=755 ./ui/scripts/docker-serve-ui.sh /serve-ui.sh')
		expect(source).not.toContain("COPY <<'EOF' /entrypoint.sh")
		for (const entrypoint of [publisherEntrypoint, serverEntrypoint]) {
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
		const server = await readFile(serverEntrypoint, 'utf8')
		const localRunCommand = 'docker run --rm -p 8080:8080 --entrypoint /serve-ui.sh zoltar-ui'
		const publishRunCommand = 'docker run --rm --add-host=host.docker.internal:host-gateway zoltar-ui'
		expect(launcher).toContain(localRunCommand)
		expect(packageSource).toContain(`"ui:publish:ipfs": "docker build -f ui/Dockerfile . -t zoltar-ui && ${publishRunCommand}"`)
		expect(packageSource).not.toContain('"ui:docker"')
		expect(await readFile(dockerfile, 'utf8')).toContain('ENTRYPOINT [ "/entrypoint.sh" ]')
		expect(await readFile(publisherEntrypoint, 'utf8')).toContain('ipfs add --api "/ip4/$IPFS_IP4_ADDRESS/tcp/5001"')
		expect(server).toContain('ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080')
		expect(server).toContain('http://localhost:8080/ipfs/${IPFS_HASH}/')
		expect(server).toContain('exec ipfs daemon')
	})
})
