import { expect, test } from 'bun:test'
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { resolveHeadlessUiSource, resolveRequestedChainId, runHeadlessTestnetDeployment } from './run-deploy-testnet.mts'

const privateKey = `0x${'11'.repeat(32)}`

async function waitForFile(filePath: string) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			await access(filePath)
			return
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
			await Bun.sleep(10)
		}
	}
	throw new Error(`Timed out waiting for ${filePath}`)
}

async function expectNoTemporaryBundle(testRoot: string) {
	expect((await readdir(testRoot)).filter(entry => entry.startsWith('zoltar-testnet-deployment-'))).toEqual([])
}

test('headless deployment bundling resolves UI-owned protocol modules without UI installs', () => {
	expect(resolveHeadlessUiSource('@zoltar/ui-core-shared/contractArtifact.js')).toEndWith(path.join('ui', 'coreShared', 'ts', 'contractArtifact.ts'))
	expect(resolveHeadlessUiSource('@zoltar/ui-zoltar-shared/protocol/deployment.js')).toEndWith(path.join('ui', 'zoltarShared', 'ts', 'protocol', 'deployment.ts'))
	expect(resolveHeadlessUiSource('@zoltar/ui-statoblast-shared/protocol/deployment.js')).toEndWith(path.join('ui', 'statoblastShared', 'ts', 'protocol', 'deployment.ts'))
})

test('headless deployment bundling rejects package traversal', () => {
	expect(() => resolveHeadlessUiSource('@zoltar/ui-zoltar-shared/../../package.js')).toThrow('escapes its UI source package')
})

test('requested chain id resolution prefers arguments over the environment', () => {
	expect(resolveRequestedChainId(['--chain-id=17000'], { CHAIN_ID: '1' })).toBe('17000')
	expect(resolveRequestedChainId(['CHAIN_ID=560048'], {})).toBe('560048')
	expect(resolveRequestedChainId(['--CHAIN_ID=5', 'CHAIN_ID=7'], {})).toBe('5')
	expect(resolveRequestedChainId(['CHAIN_ID=7', '--chain-id=5'], {})).toBe('5')
	expect(resolveRequestedChainId([], { CHAIN_ID: '17000' })).toBe('17000')
	expect(resolveRequestedChainId([], {})).toBe('11155111')
})

function stubChild(exitCode: number) {
	return { exited: Promise.resolve(exitCode), kill() {} }
}

test('headless deployment runs explorer verification after a successful deployment', async () => {
	const verificationCommands: string[][] = []
	const exitCode = await runHeadlessTestnetDeployment(['--chain-id=17000', `--private-key=${privateKey}`], {
		buildEntrypoint: async () => new Blob(['process.exitCode = 0']),
		spawnChild: () => stubChild(0),
		spawnVerification: command => {
			verificationCommands.push(command)
			return stubChild(0)
		},
	})
	expect(exitCode).toBe(0)
	expect(verificationCommands).toHaveLength(1)
	expect(verificationCommands[0]?.[1]).toEndWith(path.join('tooling', 'contracts', 'verify-contracts.mts'))
	expect(verificationCommands[0]?.[2]).toBe('--chain-id=17000')
})

test('headless deployment skips verification when the deployment fails', async () => {
	const verificationCommands: string[][] = []
	const exitCode = await runHeadlessTestnetDeployment([], {
		buildEntrypoint: async () => new Blob(['process.exitCode = 3']),
		spawnChild: () => stubChild(3),
		spawnVerification: command => {
			verificationCommands.push(command)
			return stubChild(0)
		},
	})
	expect(exitCode).toBe(3)
	expect(verificationCommands).toHaveLength(0)
})

test('headless deployment skips verification for help invocations', async () => {
	const verificationCommands: string[][] = []
	const exitCode = await runHeadlessTestnetDeployment(['--help'], {
		buildEntrypoint: async () => new Blob(['process.exitCode = 0']),
		spawnChild: () => stubChild(0),
		spawnVerification: command => {
			verificationCommands.push(command)
			return stubChild(0)
		},
	})
	expect(exitCode).toBe(0)
	expect(verificationCommands).toHaveLength(0)
})

test('headless deployment reports a verification failure after a successful deployment', async () => {
	const exitCode = await runHeadlessTestnetDeployment([], {
		buildEntrypoint: async () => new Blob(['process.exitCode = 0']),
		spawnChild: () => stubChild(0),
		spawnVerification: () => stubChild(5),
	})
	expect(exitCode).toBe(5)
})

test('headless deployment carries its pinned artifact into actual execution', async () => {
	const runnerPath = path.join(import.meta.dir, 'run-deploy-testnet.mts')
	const child = Bun.spawn([process.execPath, runnerPath, `--private-key=${privateKey}`, '--rpc-url=http://127.0.0.1:1', '--chain-id=11155111'], { stdout: 'pipe', stderr: 'pipe' })
	const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
	expect(exitCode).not.toBe(0)
	expect(stderr).toContain('Unable to connect')
	expect(stderr).not.toContain('uniswap-deployment.json')
	expect(stderr).not.toContain('ENOENT')
})

test('headless deployment forwards termination and removes its temporary bundle', async () => {
	const testRoot = await mkdtemp(path.join(tmpdir(), 'zoltar-testnet-signal-test-'))
	const childMarker = path.join(testRoot, 'child-pid')
	const runnerUrl = new URL('./run-deploy-testnet.mts', import.meta.url).href
	const wrapperSource = `
		import { runHeadlessTestnetDeployment } from ${JSON.stringify(runnerUrl)}
		const marker = ${JSON.stringify(childMarker)}
		const temporaryRoot = ${JSON.stringify(testRoot)}
		process.exitCode = await runHeadlessTestnetDeployment([], {
			temporaryRoot,
			spawnChild: () => Bun.spawn([process.execPath, '-e', \`await Bun.write(\${JSON.stringify(marker)}, String(process.pid)); await new Promise(() => {})\`]),
			spawnVerification: () => ({ exited: Promise.resolve(0), kill() {} }),
		})
	`
	let deploymentChildPid: number | undefined
	try {
		const wrapper = Bun.spawn([process.execPath, '-e', wrapperSource], { stderr: 'pipe' })
		await waitForFile(childMarker)
		const parsedDeploymentChildPid = Number.parseInt(await readFile(childMarker, 'utf8'), 10)
		deploymentChildPid = parsedDeploymentChildPid
		wrapper.kill('SIGTERM')
		expect(await wrapper.exited).toBe(143)
		expect(await readdir(testRoot)).toEqual(['child-pid'])
		expect(() => process.kill(parsedDeploymentChildPid, 0)).toThrow()
	} finally {
		if (deploymentChildPid !== undefined) {
			try {
				process.kill(deploymentChildPid, 'SIGKILL')
			} catch (error) {
				if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
			}
		}
		await rm(testRoot, { force: true, recursive: true })
	}
})

test('headless deployment handles termination before child spawn and removes its temporary bundle', async () => {
	const testRoot = await mkdtemp(path.join(tmpdir(), 'zoltar-testnet-pre-spawn-signal-test-'))
	const buildMarker = path.join(testRoot, 'build-started')
	const buildRelease = path.join(testRoot, 'release-build')
	const childMarker = path.join(testRoot, 'child-started')
	const runnerUrl = new URL('./run-deploy-testnet.mts', import.meta.url).href
	const wrapperSource = `
		import { runHeadlessTestnetDeployment } from ${JSON.stringify(runnerUrl)}
		process.exitCode = await runHeadlessTestnetDeployment([], {
			temporaryRoot: ${JSON.stringify(testRoot)},
			buildEntrypoint: async () => {
				await Bun.write(${JSON.stringify(buildMarker)}, 'ready')
				while (!(await Bun.file(${JSON.stringify(buildRelease)}).exists())) await Bun.sleep(10)
				return new Blob(['process.exitCode = 0'])
			},
			spawnChild: () => {
				Bun.write(${JSON.stringify(childMarker)}, 'started')
				return { exited: Promise.resolve(0), kill() {} }
			},
			spawnVerification: () => ({ exited: Promise.resolve(0), kill() {} }),
		})
	`
	try {
		const wrapper = Bun.spawn([process.execPath, '-e', wrapperSource], { stderr: 'pipe' })
		await waitForFile(buildMarker)
		wrapper.kill('SIGTERM')
		await Bun.write(buildRelease, 'continue')
		expect(await wrapper.exited).toBe(143)
		expect(await Bun.file(childMarker).exists()).toBe(false)
		await expectNoTemporaryBundle(testRoot)
	} finally {
		await rm(testRoot, { force: true, recursive: true })
	}
})

test('headless deployment handles termination during temporary bundle cleanup', async () => {
	const testRoot = await mkdtemp(path.join(tmpdir(), 'zoltar-testnet-cleanup-signal-test-'))
	const cleanupMarker = path.join(testRoot, 'cleanup-started')
	const cleanupRelease = path.join(testRoot, 'release-cleanup')
	const runnerUrl = new URL('./run-deploy-testnet.mts', import.meta.url).href
	const wrapperSource = `
		import { rm } from 'node:fs/promises'
		import { runHeadlessTestnetDeployment } from ${JSON.stringify(runnerUrl)}
		process.exitCode = await runHeadlessTestnetDeployment([], {
			temporaryRoot: ${JSON.stringify(testRoot)},
			buildEntrypoint: async () => new Blob(['process.exitCode = 0']),
			spawnChild: () => ({ exited: Promise.resolve(0), kill() {} }),
			spawnVerification: () => ({ exited: Promise.resolve(0), kill() {} }),
			removeTemporaryDirectory: async directory => {
				await Bun.write(${JSON.stringify(cleanupMarker)}, 'ready')
				while (!(await Bun.file(${JSON.stringify(cleanupRelease)}).exists())) await Bun.sleep(10)
				await rm(directory, { force: true, recursive: true })
			},
		})
	`
	try {
		const wrapper = Bun.spawn([process.execPath, '-e', wrapperSource], { stderr: 'pipe' })
		await waitForFile(cleanupMarker)
		wrapper.kill('SIGTERM')
		await Bun.write(cleanupRelease, 'continue')
		expect(await wrapper.exited).toBe(143)
		await expectNoTemporaryBundle(testRoot)
	} finally {
		await rm(testRoot, { force: true, recursive: true })
	}
})
