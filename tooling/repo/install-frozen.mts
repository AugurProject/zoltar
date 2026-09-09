import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { shareUiPreactRuntime } from '../ui/share-ui-preact-runtime.mjs'

const installDirectory = process.argv[2] === undefined ? process.cwd() : path.resolve(process.cwd(), process.argv[2])
const installOptions = process.argv.slice(3)
if (installOptions.some(option => option !== '--production')) throw new Error('Only --production is supported after the install directory')
const productionOnly = installOptions.includes('--production')
const packageJsonPath = path.join(installDirectory, 'package.json')
const lockfilePath = path.join(installDirectory, 'bun.lock')
const packageJsonBackupPath = `${packageJsonPath}.zoltar-install-backup`
const lockfileBackupPath = `${lockfilePath}.zoltar-install-backup`
const repositoryBunVersion = '1.4.2'

type DependencyMap = Record<string, string>
interface PackageManifest {
	dependencies?: DependencyMap
	devDependencies?: DependencyMap
	optionalDependencies?: DependencyMap
	[key: string]: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const readPackageJson = (): PackageManifest => {
	const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
	if (!isRecord(parsed)) throw new Error(`${packageJsonPath} must contain a JSON object`)
	for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
		const dependencies = parsed[section]
		if (dependencies !== undefined && !isRecord(dependencies)) throw new Error(`${packageJsonPath} has an invalid ${section} section`)
	}
	return parsed
}

const writePackageJson = (packageJson: PackageManifest): void => {
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, undefined, '\t')}\n`)
}

const writeFileAtomic = (targetPath: string, contents: string): void => {
	const temporaryPath = `${targetPath}.${process.pid}.tmp`
	writeFileSync(temporaryPath, contents)
	renameSync(temporaryPath, targetPath)
}

const restoreBackupFile = (backupPath: string, targetPath: string, options: { parseJson?: boolean } = {}): void => {
	if (!existsSync(backupPath)) return
	const contents = readFileSync(backupPath, 'utf8')
	if (options.parseJson === true) {
		JSON.parse(contents)
	}
	writeFileAtomic(targetPath, contents)
	unlinkSync(backupPath)
}

const restoreInstallBackups = () => {
	restoreBackupFile(packageJsonBackupPath, packageJsonPath, { parseJson: true })
	restoreBackupFile(lockfileBackupPath, lockfilePath)
}

restoreInstallBackups()

const runInstall = (installArguments: string[]): number => {
	// --production implicitly freezes Bun's lockfile even during the temporary
	// manifest workaround; --omit=dev preserves production scope after preflight.
	if (productionOnly) installArguments = [...installArguments, '--omit=dev']
	const command = process.versions.bun === repositoryBunVersion ? [process.execPath, ...installArguments] : [process.execPath, 'x', `bun@${repositoryBunVersion}`, ...installArguments]
	if (process.versions.bun !== repositoryBunVersion) console.warn(`Using repository Bun ${repositoryBunVersion}; current Bun is ${process.versions.bun ?? 'unknown'}.`)
	const executable = command[0]
	if (executable === undefined) throw new Error('Bun install command is empty')
	const result = spawnSync(executable, command.slice(1), {
		cwd: installDirectory,
		stdio: 'inherit',
	})

	if (result.error !== undefined) {
		throw result.error
	}

	return typeof result.status === 'number' ? result.status : 1
}

const runWindowsInstallWithoutSharedCacheCopy = () => {
	const packageJson = readPackageJson()
	const localDependencies = (['dependencies', 'devDependencies', 'optionalDependencies'] as const).flatMap(section =>
		Object.entries(packageJson[section] ?? {})
			.filter(([name, value]) => name.startsWith('@zoltar/') && value.startsWith('file:'))
			.map(([name]) => ({ section, name })),
	)
	if (localDependencies.length === 0) {
		return runInstall(['install', '--frozen-lockfile', '--backend=copyfile'])
	}

	const originalPackageJson = readFileSync(packageJsonPath, 'utf8')
	const originalLockfile = existsSync(lockfilePath) ? readFileSync(lockfilePath, 'utf8') : undefined
	writeFileAtomic(packageJsonBackupPath, originalPackageJson)
	if (originalLockfile !== undefined) {
		writeFileAtomic(lockfileBackupPath, originalLockfile)
	}

	const restoreAndExit = (exitStatus: number): never => {
		restoreInstallBackups()
		process.exit(exitStatus)
	}
	process.once('SIGINT', () => restoreAndExit(130))
	process.once('SIGTERM', () => restoreAndExit(143))
	process.once('SIGHUP', () => restoreAndExit(129))

	try {
		for (const { section, name } of localDependencies) delete packageJson[section]?.[name]
		writePackageJson(packageJson)
		return runInstall(['install', '--no-save', '--backend=copyfile'])
	} finally {
		restoreInstallBackups()
	}
}

const linkLocalZoltarDependencies = () => {
	const packageJson = readPackageJson()
	for (const dependencies of [packageJson.dependencies, ...(productionOnly ? [] : [packageJson.devDependencies]), packageJson.optionalDependencies]) {
		for (const [dependencyName, dependencySource] of Object.entries(dependencies ?? {})) {
			if (!dependencyName.startsWith('@zoltar/') || !dependencySource.startsWith('file:')) continue
			const sourcePath = path.resolve(installDirectory, dependencySource.slice('file:'.length))
			const installedPath = path.join(installDirectory, 'node_modules', ...dependencyName.split('/'))
			mkdirSync(path.dirname(installedPath), { recursive: true })
			rmSync(installedPath, { force: true, recursive: true })
			symlinkSync(sourcePath, installedPath, 'dir')
		}
	}
}

const unlinkLocalZoltarDependencies = () => {
	const packageJson = readPackageJson()
	for (const dependencies of [packageJson.dependencies, ...(productionOnly ? [] : [packageJson.devDependencies]), packageJson.optionalDependencies]) {
		for (const [dependencyName, dependencySource] of Object.entries(dependencies ?? {})) {
			if (!dependencyName.startsWith('@zoltar/') || !dependencySource.startsWith('file:')) continue
			const installedPath = path.join(installDirectory, 'node_modules', ...dependencyName.split('/'))
			if (existsSync(installedPath) && lstatSync(installedPath).isSymbolicLink()) unlinkSync(installedPath)
		}
	}
}

const isEscapingLocalDependency = (dependencySource: string): boolean => {
	if (!dependencySource.startsWith('file:')) return false
	const sourcePath = path.resolve(installDirectory, dependencySource.slice('file:'.length))
	const relativeSourcePath = path.relative(installDirectory, sourcePath)
	return relativeSourcePath === '..' || relativeSourcePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSourcePath)
}

const runNonWindowsInstallWithoutLocalDependencies = () => {
	const packageJson = readPackageJson()
	let changed = false
	for (const dependencySection of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
		for (const [dependencyName, dependencySource] of Object.entries(packageJson[dependencySection] ?? {})) {
			if (!dependencyName.startsWith('@zoltar/') || !isEscapingLocalDependency(dependencySource)) continue
			delete packageJson[dependencySection]?.[dependencyName]
			changed = true
		}
	}
	if (!changed) return runInstall(['install', '--frozen-lockfile'])
	const originalPackageJson = readFileSync(packageJsonPath, 'utf8')
	writeFileAtomic(packageJsonBackupPath, originalPackageJson)
	writePackageJson(packageJson)
	try {
		return runInstall(['install', '--no-save'])
	} finally {
		restoreInstallBackups()
	}
}

if (process.platform !== 'win32') {
	const preflightStatus = runInstall(['install', '--frozen-lockfile', '--lockfile-only'])
	if (preflightStatus !== 0) process.exit(preflightStatus)
	unlinkLocalZoltarDependencies()
}
const exitStatus = process.platform === 'win32' ? runWindowsInstallWithoutSharedCacheCopy() : runNonWindowsInstallWithoutLocalDependencies()
if (exitStatus === 0) {
	if (process.platform !== 'win32') linkLocalZoltarDependencies()
	shareUiPreactRuntime(installDirectory)
}

process.exit(exitStatus)
