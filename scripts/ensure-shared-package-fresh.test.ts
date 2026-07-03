import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'

const scriptDirectoryPath = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(scriptDirectoryPath, '..')
const sharedPackagePath = path.join(repositoryRootPath, 'shared')
const sharedRefreshScriptPath = path.join(scriptDirectoryPath, 'ensure-shared-package-fresh.mjs')

async function writeFixtureFile(rootPath: string, relativePath: string, contents: string) {
	const filePath = path.join(rootPath, relativePath)
	await mkdir(path.dirname(filePath), { recursive: true })
	await writeFile(filePath, contents)
}

test('shared dependency refresh syncs the installed package without requiring bun install metadata', async () => {
	const consumerRootPath = await mkdtemp(path.join(tmpdir(), 'zoltar-shared-refresh-'))
	try {
		await writeFixtureFile(consumerRootPath, 'node_modules/@zoltar/shared/package.json', JSON.stringify({ name: '@zoltar/shared', version: '0.0.0' }))
		await writeFixtureFile(consumerRootPath, 'node_modules/@zoltar/shared/js/constants.js', 'export const stale = true\n')
		await writeFixtureFile(consumerRootPath, 'node_modules/@zoltar/shared/js/removed.js', 'export const removed = true\n')

		const result = Bun.spawnSync([process.execPath, sharedRefreshScriptPath, '--refresh'], {
			cwd: consumerRootPath,
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const stdout = Buffer.from(result.stdout).toString('utf8')
		const stderr = Buffer.from(result.stderr).toString('utf8')

		expect(result.exitCode).toBe(0)
		expect(`${stdout}${stderr}`).not.toContain('bun install')
		await expect(readFile(path.join(consumerRootPath, 'node_modules/@zoltar/shared/js/removed.js'), 'utf8')).rejects.toThrow()

		const [installedPackageJson, sourcePackageJson, installedConstantsSource, sourceConstantsSource] = await Promise.all([
			readFile(path.join(consumerRootPath, 'node_modules/@zoltar/shared/package.json'), 'utf8'),
			readFile(path.join(sharedPackagePath, 'package.json'), 'utf8'),
			readFile(path.join(consumerRootPath, 'node_modules/@zoltar/shared/js/constants.js'), 'utf8'),
			readFile(path.join(sharedPackagePath, 'js/constants.js'), 'utf8'),
		])

		expect(installedPackageJson).toBe(sourcePackageJson)
		expect(installedConstantsSource).toBe(sourceConstantsSource)
	} finally {
		await rm(consumerRootPath, { force: true, recursive: true })
	}
})
