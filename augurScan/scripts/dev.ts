import { watch } from 'node:fs'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')
const build = async (): Promise<void> => {
	const child = Bun.spawn([process.execPath, 'run', 'build'], { cwd: projectRoot, stderr: 'inherit', stdout: 'inherit' })
	const status = await child.exited
	if (status !== 0) throw new Error(`AugurScan browser build exited with status ${status}`)
}

await build()
const app = Bun.spawn([process.execPath, '--watch', 'src/server.ts'], {
	cwd: projectRoot,
	env: process.env,
	stderr: 'inherit',
	stdout: 'inherit',
})
const indexer = Bun.spawn([process.execPath, '--watch', 'src/indexer-process.ts'], {
	cwd: projectRoot,
	env: process.env,
	stderr: 'inherit',
	stdout: 'inherit',
})

let buildInProgress = false
let buildQueued = false
const drainBuilds = async (): Promise<void> => {
	if (buildInProgress) return
	buildInProgress = true
	try {
		do {
			buildQueued = false
			try {
				await build()
			} catch (error: unknown) {
				console.error(error instanceof Error ? error.message : String(error))
			}
		} while (buildQueued)
	} finally {
		buildInProgress = false
	}
}
const browserWatcher = watch(path.join(projectRoot, 'browser'), { recursive: true }, () => {
	buildQueued = true
	void drainBuilds()
})

let shuttingDown = false
const shutdown = (): void => {
	if (shuttingDown) return
	shuttingDown = true
	browserWatcher.close()
	app.kill()
	indexer.kill()
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

const watchExit = async (name: string, subprocess: typeof app): Promise<number> => {
	const exitCode = await subprocess.exited
	if (!shuttingDown) {
		console.error(`AugurScan ${name} process exited with status ${exitCode}`)
		shutdown()
	}
	return exitCode
}

const [appExitCode, indexerExitCode] = await Promise.all([watchExit('app', app), watchExit('indexer', indexer)])
process.exitCode = appExitCode !== 0 ? appExitCode : indexerExitCode
