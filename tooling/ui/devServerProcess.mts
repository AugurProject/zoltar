import { spawn, type ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import type { UiAppId } from './appPaths.mts'

const repositoryRoot = path.resolve(import.meta.dir, '..', '..')
const SERVER_LISTEN_TIMEOUT_MILLISECONDS = 60_000

/** Builds the app from this checkout and serves it on a free port, so another checkout's server on the fixed port is never captured. */
export async function startDevServer(appId: UiAppId, options: { readonly prepareSnapshots?: boolean } = {}): Promise<{ readonly server: ChildProcess; readonly baseUrl: string }> {
	console.log(`Building the ${appId} UI (the first build compiles contracts and can take several minutes)...`)
	const build = Bun.spawn([process.execPath, './tooling/ui/apps.mts', appId], { cwd: repositoryRoot, stdout: 'ignore', stderr: 'inherit' })
	if ((await build.exited) !== 0) throw new Error(`Building the ${appId} UI failed`)
	if (options.prepareSnapshots === true) {
		// Prepared scenario snapshots restore a seeded chain in about a second instead of replaying the seeding on every page load.
		const snapshots = Bun.spawn([process.execPath, './tooling/ui/simulationSnapshots.mts', appId], { cwd: repositoryRoot, stdout: 'ignore', stderr: 'inherit' })
		if ((await snapshots.exited) !== 0) throw new Error(`Preparing the ${appId} simulation snapshots failed`)
	}
	const server = spawn(process.execPath, ['./tooling/ui/dev-server.ts', appId], { cwd: repositoryRoot, env: { ...process.env, UI_DEV_SERVER_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
	let output = ''
	const collect = (chunk: unknown) => {
		output = `${output}${String(chunk)}`.slice(-10_000)
	}
	server.stdout?.on('data', collect)
	server.stderr?.on('data', collect)
	const deadline = Date.now() + SERVER_LISTEN_TIMEOUT_MILLISECONDS
	while (Date.now() < deadline) {
		const port = /listening at http:\/\/localhost:(\d+)/.exec(output)?.[1]
		if (port !== undefined) return { server, baseUrl: `http://127.0.0.1:${port}` }
		if (server.exitCode !== null) throw new Error(`The ${appId} development server exited with code ${server.exitCode.toString()}:\n${output}`)
		await Bun.sleep(200)
	}
	stopDevServer(server)
	throw new Error(`The ${appId} development server did not start listening within ${(SERVER_LISTEN_TIMEOUT_MILLISECONDS / 1000).toString()} seconds:\n${output}`)
}

// The server shares this process group, so an interrupt stops it together with the capture.
export function stopDevServer(server: ChildProcess) {
	if (server.exitCode === null) server.kill('SIGTERM')
}
