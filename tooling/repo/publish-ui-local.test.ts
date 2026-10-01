import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { kuboImageFromDockerfile, localPublishSteps } from './publish-ui-local.mts'
import { repositoryRoot } from './root.mts'

test('local UI publishing probes the host node, builds the local publisher, and runs it', async () => {
	const kuboImage = kuboImageFromDockerfile(await readFile(path.join(repositoryRoot, 'ui/Dockerfile'), 'utf8'))
	const commands = localPublishSteps(kuboImage, '/dns4/host.docker.internal/tcp/5001').map(step => step.command.join(' '))
	expect(commands).toEqual([
		'docker info',
		`docker run --rm --add-host=host.docker.internal:host-gateway --entrypoint ipfs ${kuboImage} --api /dns4/host.docker.internal/tcp/5001 --timeout=10s id`,
		'docker build --target local-publisher -f ui/Dockerfile . -t zoltar-local-ipfs-publisher',
		'docker run --rm --add-host=host.docker.internal:host-gateway -e IPFS_API=/dns4/host.docker.internal/tcp/5001 zoltar-local-ipfs-publisher',
	])
})

test('rejects a Dockerfile without the pinned Kubo stage', () => {
	expect(() => kuboImageFromDockerfile('FROM debian AS publisher\n')).toThrow('ui/Dockerfile must define an ipfs-kubo stage')
})
