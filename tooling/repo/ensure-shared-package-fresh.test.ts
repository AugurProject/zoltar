import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'

const scriptDirectoryPath = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(scriptDirectoryPath, '..', '..')
const sharedPackagePath = path.join(repositoryRootPath, 'shared', 'zoltar')
const sharedRefreshScriptPath = path.join(scriptDirectoryPath, 'ensure-shared-package-fresh.mts')

async function writeFixtureFile(rootPath: string, relativePath: string, contents: string) {
	const filePath = path.join(rootPath, relativePath)
	await mkdir(path.dirname(filePath), { recursive: true })
	await writeFile(filePath, contents)
}

test('shared dependency refresh syncs the installed package without requiring bun install metadata', async () => {
	const consumerRootPath = await mkdtemp(path.join(tmpdir(), 'zoltar-shared-refresh-'))
	try {
		await writeFixtureFile(consumerRootPath, 'package.json', JSON.stringify({ dependencies: { '@zoltar/zoltar-shared': 'file:unused-in-fixture' } }))
		await writeFixtureFile(consumerRootPath, 'node_modules/@zoltar/zoltar-shared/package.json', JSON.stringify({ name: '@zoltar/zoltar-shared', version: '0.0.0' }))
		await writeFixtureFile(consumerRootPath, 'node_modules/@zoltar/zoltar-shared/js/constants.js', 'export const stale = true\n')
		await writeFixtureFile(consumerRootPath, 'node_modules/@zoltar/zoltar-shared/js/removed.js', 'export const removed = true\n')

		const result = Bun.spawnSync([process.execPath, sharedRefreshScriptPath, '--refresh'], {
			cwd: consumerRootPath,
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const stdout = Buffer.from(result.stdout).toString('utf8')
		const stderr = Buffer.from(result.stderr).toString('utf8')

		expect(result.exitCode).toBe(0)
		expect(`${stdout}${stderr}`).not.toContain('bun install')
		await expect(readFile(path.join(consumerRootPath, 'node_modules/@zoltar/zoltar-shared/js/removed.js'), 'utf8')).rejects.toThrow()

		const [installedPackageJson, sourcePackageJson, installedConstantsSource, sourceConstantsSource] = await Promise.all([
			readFile(path.join(consumerRootPath, 'node_modules/@zoltar/zoltar-shared/package.json'), 'utf8'),
			readFile(path.join(sharedPackagePath, 'package.json'), 'utf8'),
			readFile(path.join(consumerRootPath, 'node_modules/@zoltar/zoltar-shared/js/constants.js'), 'utf8'),
			readFile(path.join(sharedPackagePath, 'js/constants.js'), 'utf8'),
		])

		expect(installedPackageJson).toBe(sourcePackageJson)
		expect(installedConstantsSource).toBe(sourceConstantsSource)

		await writeFixtureFile(consumerRootPath, 'node_modules/@zoltar/zoltar-shared/js/removed.js', 'export const removed = true\n')
		const staleExtraFileCheck = Bun.spawnSync([process.execPath, sharedRefreshScriptPath], {
			cwd: consumerRootPath,
			stdout: 'pipe',
			stderr: 'pipe',
		})
		expect(staleExtraFileCheck.exitCode).toBe(1)

		const extraFileRefresh = Bun.spawnSync([process.execPath, sharedRefreshScriptPath, '--refresh'], {
			cwd: consumerRootPath,
			stdout: 'pipe',
			stderr: 'pipe',
		})
		expect(extraFileRefresh.exitCode).toBe(0)
		await expect(readFile(path.join(consumerRootPath, 'node_modules/@zoltar/zoltar-shared/js/removed.js'), 'utf8')).rejects.toThrow()
		for (const mode of ['changed', 'missing'] as const) {
			const constantsPath = path.join(consumerRootPath, 'node_modules/@zoltar/zoltar-shared/js/constants.js')
			if (mode === 'changed') await writeFile(constantsPath, 'export const stale = true\n')
			else await rm(constantsPath)
			const check = Bun.spawnSync([process.execPath, sharedRefreshScriptPath], { cwd: consumerRootPath, stdout: 'pipe', stderr: 'pipe' })
			expect(check.exitCode).toBe(1)
			const refresh = Bun.spawnSync([process.execPath, sharedRefreshScriptPath, '--refresh'], { cwd: consumerRootPath, stdout: 'pipe', stderr: 'pipe' })
			expect(refresh.exitCode).toBe(0)
			expect(await readFile(constantsPath, 'utf8')).toBe(sourceConstantsSource)
		}
	} finally {
		await rm(consumerRootPath, { force: true, recursive: true })
	}
})
