import { expect, test } from 'bun:test'
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'

const scriptDirectoryPath = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(scriptDirectoryPath, '..', '..')
const installScriptPath = path.join(scriptDirectoryPath, 'install-frozen.mts')

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

const runNativeInstall = (installDirectory: string, options: string[] = []) => {
	const result = Bun.spawnSync([process.execPath, installScriptPath, installDirectory, ...options], {
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

test.each(['development', 'production'])('native %s install rejects a stale registry lock without modifying inputs', async mode => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'zoltar-install-frozen-native-'))
	const installDirectory = path.join(temporaryRoot, 'app')
	const sharedDirectory = path.join(temporaryRoot, 'shared')
	try {
		await mkdir(installDirectory)
		await mkdir(sharedDirectory)
		await writeFile(path.join(sharedDirectory, 'package.json'), createPackageJson({}))
		await writeFile(path.join(installDirectory, 'package.json'), createPackageJson({ '@zoltar/shared': 'file:../shared', kleur: '4.1.5' }))
		const initialInstall = Bun.spawnSync([process.execPath, 'install'], { cwd: installDirectory, stderr: 'pipe', stdout: 'pipe' })
		expect(initialInstall.exitCode).toBe(0)
		const installedSharedPath = path.join(installDirectory, 'node_modules', '@zoltar', 'shared')
		await rm(installedSharedPath, { force: true, recursive: true })
		await symlink(sharedDirectory, installedSharedPath, 'dir')

		const stalePackageJson = createPackageJson({ '@zoltar/shared': 'file:../shared', kleur: '4.1.4' })
		await writeFile(path.join(installDirectory, 'package.json'), stalePackageJson)
		const originalLockfile = await readFile(path.join(installDirectory, 'bun.lock'), 'utf8')
		const result = runNativeInstall(installDirectory, mode === 'production' ? ['--production'] : [])

		expect(result.exitCode).not.toBe(0)
		expect(await readFile(path.join(installDirectory, 'package.json'), 'utf8')).toBe(stalePackageJson)
		expect(await readFile(path.join(installDirectory, 'bun.lock'), 'utf8')).toBe(originalLockfile)
		expect((await lstat(installedSharedPath)).isSymbolicLink()).toBe(true)
		await expectNoInstallBackups(installDirectory)
	} finally {
		await rm(temporaryRoot, { force: true, recursive: true })
	}
})

test('native install retains transitive dependencies from safe local packages', async () => {
	const installDirectory = await mkdtemp(path.join(tmpdir(), 'zoltar-install-frozen-safe-local-'))
	const sharedDirectory = path.join(installDirectory, 'shared')
	try {
		await mkdir(sharedDirectory)
		await writeFile(path.join(sharedDirectory, 'package.json'), `${JSON.stringify({ name: '@zoltar/shared', version: '1.0.0', dependencies: { kleur: '4.1.5' } }, undefined, '\t')}\n`)
		await writeFile(path.join(installDirectory, 'package.json'), createPackageJson({ '@zoltar/shared': 'file:shared' }))
		const initialInstall = Bun.spawnSync([process.execPath, 'install'], { cwd: installDirectory, stderr: 'pipe', stdout: 'pipe' })
		expect(initialInstall.exitCode).toBe(0)
		await rm(path.join(installDirectory, 'node_modules'), { force: true, recursive: true })

		const result = runNativeInstall(installDirectory)

		if (result.exitCode !== 0) throw new Error(`${result.stdout}\n${result.stderr}`)
		expect(await readFile(path.join(installDirectory, 'node_modules', 'kleur', 'package.json'), 'utf8')).toContain('"version": "4.1.5"')
		await expectNoInstallBackups(installDirectory)
	} finally {
		await rm(installDirectory, { force: true, recursive: true })
	}
})

test('production installs resolve nested bot packages without development dependencies', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'zoltar-install-production-'))
	const botPackages = ['bots/liquidator', 'bots/chaos', 'bots/open-oracle-arbitrager']
	const packages = ['shared', 'bots/shared', ...botPackages]
	try {
		for (const packagePath of packages) {
			const directory = path.join(root, packagePath)
			await mkdir(directory, { recursive: true })
			for (const file of ['package.json', 'bun.lock']) await cp(path.join(repositoryRootPath, packagePath, file), path.join(directory, file))
		}
		await cp(path.join(repositoryRootPath, 'shared/ts'), path.join(root, 'shared/ts'), { recursive: true })
		await cp(path.join(repositoryRootPath, 'bots/shared/src'), path.join(root, 'bots/shared/src'), { recursive: true })
		for (const packagePath of packages) {
			const directory = path.join(root, packagePath)
			const manifest = await readFile(path.join(directory, 'package.json'), 'utf8')
			const lockfile = await readFile(path.join(directory, 'bun.lock'), 'utf8')
			const result = runNativeInstall(directory, ['--production'])
			if (result.exitCode !== 0) throw new Error(`${result.stdout}\n${result.stderr}`)
			expect(await readFile(path.join(directory, 'package.json'), 'utf8')).toBe(manifest)
			expect(await readFile(path.join(directory, 'bun.lock'), 'utf8')).toBe(lockfile)
			await expectNoInstallBackups(directory)
			await expect(lstat(path.join(directory, 'node_modules/typescript'))).rejects.toThrow()
		}
		for (const packagePath of botPackages) {
			const runtime = Bun.spawnSync([process.execPath, '--eval', "import { getAddress } from '@zoltar/bot-shared/ethereum'; getAddress('0x0000000000000000000000000000000000000001')"], { cwd: path.join(root, packagePath), stdout: 'pipe', stderr: 'pipe' })
			expect(runtime.exitCode).toBe(0)
		}
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
