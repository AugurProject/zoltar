import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'

const installDirectory = process.argv[2] === undefined ? process.cwd() : path.resolve(process.cwd(), process.argv[2])
const packageJsonPath = path.join(installDirectory, 'package.json')
const lockfilePath = path.join(installDirectory, 'bun.lock')
const packageJsonBackupPath = `${packageJsonPath}.zoltar-install-backup`
const lockfileBackupPath = `${lockfilePath}.zoltar-install-backup`

type DependencySection = 'dependencies' | 'devDependencies' | 'optionalDependencies'
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

const getSharedDependencySection = (packageJson: PackageManifest): DependencySection | undefined => {
	for (const dependencySection of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
		if (packageJson[dependencySection]?.['@zoltar/shared'] !== undefined) return dependencySection
	}
	return undefined
}

const runInstall = (installArguments: string[]): number => {
	const result = spawnSync(process.execPath, installArguments, {
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
	const sharedDependencySection = getSharedDependencySection(packageJson)
	if (sharedDependencySection === undefined) {
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
		const dependencies = packageJson[sharedDependencySection]
		if (dependencies === undefined) throw new Error(`Missing ${sharedDependencySection} after dependency detection`)
		delete dependencies['@zoltar/shared']
		writePackageJson(packageJson)
		return runInstall(['install', '--no-save', '--backend=copyfile'])
	} finally {
		restoreInstallBackups()
	}
}

const exitStatus = process.platform === 'win32' ? runWindowsInstallWithoutSharedCacheCopy() : runInstall(['install', '--frozen-lockfile'])

process.exit(exitStatus)
