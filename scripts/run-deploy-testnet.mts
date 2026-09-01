#!/usr/bin/env bun

import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import * as url from 'node:url'

const repositoryRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const deploymentEntrypoint = path.join(repositoryRoot, 'scripts', 'deploy-testnet.mts')
const forwardedSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
const uiSourceRoots: Readonly<Record<string, string>> = {
	'@zoltar/ui-core-shared': path.join(repositoryRoot, 'ui', 'coreShared', 'ts'),
	'@zoltar/ui-statoblast': path.join(repositoryRoot, 'ui', 'statoblast', 'ts'),
	'@zoltar/ui-zoltar': path.join(repositoryRoot, 'ui', 'zoltar', 'ts'),
}

export function resolveHeadlessUiSource(specifier: string): string | undefined {
	const packageEntry = Object.entries(uiSourceRoots).find(([packageName]) => specifier.startsWith(`${packageName}/`))
	if (packageEntry === undefined) return undefined
	const [packageName, sourceRoot] = packageEntry
	const relativeSourcePath = specifier.slice(packageName.length + 1).replace(/\.js$/u, '')
	for (const extension of ['.ts', '.tsx']) {
		const candidate = path.resolve(sourceRoot, `${relativeSourcePath}${extension}`)
		if (!candidate.startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`Headless deployment import escapes its UI source package: ${specifier}`)
		if (existsSync(candidate)) return candidate
	}
	throw new Error(`Headless deployment import has no TypeScript source: ${specifier}`)
}

const headlessUiSourcePlugin: Bun.BunPlugin = {
	name: 'headless-ui-protocol-sources',
	setup(build) {
		build.onResolve({ filter: /^@zoltar\/ui-/u }, args => {
			const resolvedPath = resolveHeadlessUiSource(args.path)
			return resolvedPath === undefined ? undefined : { path: resolvedPath }
		})
	},
}

type DeploymentChild = {
	exited: Promise<number>
	kill(signal?: NodeJS.Signals | number): void
}

type HeadlessDeploymentOptions = {
	buildEntrypoint?: (sourceEntrypoint: string) => Promise<Blob>
	removeTemporaryDirectory?: (temporaryDirectory: string) => Promise<void>
	spawnChild?: (command: string[]) => DeploymentChild
	temporaryRoot?: string
}

const signalExitCodes: Readonly<Record<(typeof forwardedSignals)[number], number>> = {
	SIGHUP: 129,
	SIGINT: 130,
	SIGTERM: 143,
}

function isNoSuchProcessError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}

async function buildHeadlessEntrypoint(sourceEntrypoint: string) {
	const build = await Bun.build({
		entrypoints: [sourceEntrypoint],
		plugins: [headlessUiSourcePlugin],
		target: 'bun',
	})
	const output = build.outputs.find(candidate => candidate.kind === 'entry-point')
	if (output === undefined) throw new Error('Headless testnet deployment bundle did not produce an entry point')
	return output
}

export async function runHeadlessTestnetDeployment(args: readonly string[], options: HeadlessDeploymentOptions = {}) {
	let activeChild: DeploymentChild | undefined
	let exitCode = 0
	let failure: unknown
	let receivedSignal: (typeof forwardedSignals)[number] | undefined
	let temporaryDirectory: string | undefined
	const handlers = forwardedSignals.map(signal => {
		const handler = () => {
			receivedSignal ??= signal
			try {
				activeChild?.kill(signal)
			} catch (error) {
				if (!isNoSuchProcessError(error)) console.error(`Unable to forward ${signal} to the testnet deployment child`, error)
			}
		}
		process.on(signal, handler)
		return { handler, signal }
	})
	try {
		temporaryDirectory = await mkdtemp(path.join(options.temporaryRoot ?? tmpdir(), 'zoltar-testnet-deployment-'))
		const sourceEntrypoint = path.join(temporaryDirectory, 'deploy-testnet-entry.mts')
		await Bun.write(sourceEntrypoint, `import { main } from ${JSON.stringify(deploymentEntrypoint)}\nmain().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })\n`)
		const output = await (options.buildEntrypoint ?? buildHeadlessEntrypoint)(sourceEntrypoint)
		if (receivedSignal === undefined) {
			const bundledEntrypoint = path.join(temporaryDirectory, 'deploy-testnet.js')
			await Bun.write(bundledEntrypoint, output)
			const bundledArtifactsDirectory = path.join(temporaryDirectory, 'artifacts')
			await mkdir(bundledArtifactsDirectory)
			await copyFile(path.join(repositoryRoot, 'scripts', 'artifacts', 'uniswap-deployment.json'), path.join(bundledArtifactsDirectory, 'uniswap-deployment.json'))
			if (receivedSignal === undefined) {
				const command = [process.execPath, bundledEntrypoint, ...args]
				activeChild = options.spawnChild?.(command) ?? Bun.spawn(command, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
				exitCode = await activeChild.exited
			}
		}
	} catch (error) {
		failure = error
	} finally {
		try {
			if (temporaryDirectory !== undefined) {
				await (options.removeTemporaryDirectory ?? (directory => rm(directory, { force: true, recursive: true })))(temporaryDirectory)
			}
		} finally {
			for (const { handler, signal } of handlers) process.off(signal, handler)
		}
	}
	if (receivedSignal !== undefined) return signalExitCodes[receivedSignal]
	if (failure !== undefined) throw failure
	return exitCode
}

if (import.meta.main) process.exitCode = await runHeadlessTestnetDeployment(process.argv.slice(2))
