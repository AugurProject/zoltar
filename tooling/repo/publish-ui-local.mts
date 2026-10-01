import { readFileSync } from 'node:fs'
import path from 'node:path'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { repositoryRoot } from './root.mts'

/**
 * Builds all three UIs and pins them on the IPFS node that is already running on the host.
 * Run it with `bun run ui:publish:local`; publish.bat is a Windows double-click wrapper around that command.
 */
const defaultLocalIpfsApi = '/dns4/host.docker.internal/tcp/5001'
const localPublisherImage = 'zoltar-local-ipfs-publisher'
// Linux Docker engines resolve host.docker.internal only when it is mapped explicitly; Docker Desktop accepts the same mapping.
const hostGateway = '--add-host=host.docker.internal:host-gateway'

type PublishStep = {
	readonly description: string
	readonly command: readonly string[]
	/** Discard standard output of probe commands. */
	readonly quiet: boolean
	readonly failure: string
}

/** Reads the pinned Kubo image reference from the ipfs-kubo stage so it cannot drift from the Dockerfile. */
export function kuboImageFromDockerfile(dockerfile: string): string {
	const match = /^FROM\s+(\S+)\s+AS\s+ipfs-kubo\s*$/mu.exec(dockerfile)
	if (match?.[1] === undefined) throw new Error('ui/Dockerfile must define an ipfs-kubo stage')
	return match[1]
}

export function localPublishSteps(kuboImage: string, ipfsApi: string): PublishStep[] {
	return [
		{ description: 'Checking Docker...', command: ['docker', 'info'], quiet: true, failure: 'Start Docker with Linux containers, then run bun run ui:publish:local again.' },
		{
			description: 'Checking your local IPFS node...',
			command: ['docker', 'run', '--rm', hostGateway, '--entrypoint', 'ipfs', kuboImage, '--api', ipfsApi, '--timeout=10s', 'id'],
			quiet: true,
			failure: 'Could not connect to your local IPFS API from Docker. Start your IPFS node and ensure its API is reachable from Docker at host.docker.internal:5001, or set IPFS_API to its Kubo API multiaddress.',
		},
		{ description: 'Building Zoltar, Statoblast, Trading, and the IPFS publisher...', command: ['docker', 'build', '--target', 'local-publisher', '-f', 'ui/Dockerfile', '.', '-t', localPublisherImage], quiet: false, failure: 'Building the local publisher image failed.' },
		{ description: 'Publishing all three UIs...', command: ['docker', 'run', '--rm', hostGateway, '-e', `IPFS_API=${ipfsApi}`, localPublisherImage], quiet: false, failure: 'Publishing to your local IPFS node failed.' },
	]
}

async function publishLocal() {
	const ipfsApi = process.env['IPFS_API'] ?? defaultLocalIpfsApi
	const kuboImage = kuboImageFromDockerfile(readFileSync(path.join(repositoryRoot, 'ui/Dockerfile'), 'utf8'))
	for (const step of localPublishSteps(kuboImage, ipfsApi)) {
		console.log(step.description)
		const child = Bun.spawn({ cmd: [...step.command], cwd: repositoryRoot, stdin: 'inherit', stdout: step.quiet ? 'ignore' : 'inherit', stderr: 'inherit' })
		if ((await child.exited) !== 0) throw new Error(step.failure)
	}
	console.log('All three UIs are pinned on your local IPFS node. Keep it running to serve them.')
}

if (import.meta.main) {
	try {
		await publishLocal()
	} catch (error) {
		console.error(`Publishing failed. ${errorMessage(error)}`)
		process.exit(1)
	}
}
