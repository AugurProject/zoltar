import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'

const scriptDirectoryPath = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(scriptDirectoryPath, '..')
const installScriptPath = path.join(scriptDirectoryPath, 'install-frozen.mjs')

const createPackageJson = (dependencies: Record<string, string>) =>
	`${JSON.stringify(
		{
			type: 'module',
			dependencies,
		},
		undefined,
		'\t',
	)}\n`

const runForcedWindowsInstall = (installDirectory: string) => {
	const result = Bun.spawnSync([process.execPath, '-e', `Object.defineProperty(process, 'platform', { value: 'win32' }); process.argv = [process.argv[0], process.argv[1], ${JSON.stringify(installDirectory)}]; await import(${JSON.stringify(installScriptPath)})`], {
		cwd: repositoryRootPath,
		stderr: 'pipe',
		stdout: 'pipe',
	})
	return {
		exitCode: result.exitCode,
		stderr: Buffer.from(result.stderr).toString('utf8'),
		stdout: Buffer.from(result.stdout).toString('utf8'),
	}
}

const expectNoInstallBackups = async (installDirectory: string) => {
	await expect(readFile(path.join(installDirectory, 'package.json.zoltar-install-backup'), 'utf8')).rejects.toThrow()
	await expect(readFile(path.join(installDirectory, 'bun.lock.zoltar-install-backup'), 'utf8')).rejects.toThrow()
}

test('windows install workaround restores package and lock inputs after omitting shared', async () => {
	const installDirectory = await mkdtemp(path.join(tmpdir(), 'zoltar-install-frozen-'))
	try {
		const originalPackageJson = createPackageJson({
			'@zoltar/shared': 'file:../shared',
		})
		const originalLockfile = 'lockfile stays restored\n'
		await writeFile(path.join(installDirectory, 'package.json'), originalPackageJson)
		await writeFile(path.join(installDirectory, 'bun.lock'), originalLockfile)

		const result = runForcedWindowsInstall(installDirectory)

		expect(result.exitCode).toBe(0)
		expect(`${result.stdout}${result.stderr}`).not.toContain('failed copying files from cache')
		expect(await readFile(path.join(installDirectory, 'package.json'), 'utf8')).toBe(originalPackageJson)
		expect(await readFile(path.join(installDirectory, 'bun.lock'), 'utf8')).toBe(originalLockfile)
		await expectNoInstallBackups(installDirectory)
	} finally {
		await rm(installDirectory, { force: true, recursive: true })
	}
})

test('windows install workaround restores stale backups before installing', async () => {
	const installDirectory = await mkdtemp(path.join(tmpdir(), 'zoltar-install-frozen-recovery-'))
	try {
		const originalPackageJson = createPackageJson({
			'@zoltar/shared': 'file:../shared',
		})
		const originalLockfile = 'stale lock backup\n'
		await writeFile(path.join(installDirectory, 'package.json'), createPackageJson({}))
		await writeFile(path.join(installDirectory, 'package.json.zoltar-install-backup'), originalPackageJson)
		await writeFile(path.join(installDirectory, 'bun.lock.zoltar-install-backup'), originalLockfile)

		const result = runForcedWindowsInstall(installDirectory)

		expect(result.exitCode).toBe(0)
		expect(await readFile(path.join(installDirectory, 'package.json'), 'utf8')).toBe(originalPackageJson)
		expect(await readFile(path.join(installDirectory, 'bun.lock'), 'utf8')).toBe(originalLockfile)
		await expectNoInstallBackups(installDirectory)
	} finally {
		await rm(installDirectory, { force: true, recursive: true })
	}
})

test('windows install workaround rejects invalid package backups without corrupting package json', async () => {
	const installDirectory = await mkdtemp(path.join(tmpdir(), 'zoltar-install-frozen-invalid-backup-'))
	try {
		const currentPackageJson = createPackageJson({})
		await writeFile(path.join(installDirectory, 'package.json'), currentPackageJson)
		await writeFile(path.join(installDirectory, 'package.json.zoltar-install-backup'), '{')

		const result = runForcedWindowsInstall(installDirectory)

		expect(result.exitCode).not.toBe(0)
		expect(await readFile(path.join(installDirectory, 'package.json'), 'utf8')).toBe(currentPackageJson)
	} finally {
		await rm(installDirectory, { force: true, recursive: true })
	}
})
