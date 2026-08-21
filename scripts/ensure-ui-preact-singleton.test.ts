import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureUiPreactSingleton, preactSingletonDependencyPaths, uiPackageIds } from './ensure-ui-preact-singleton.mts'

describe('UI Preact dependency topology', () => {
	test('links every UI package to the root Preact instance and is idempotent', async () => {
		const temporaryRoot = await mkdtemp(join(tmpdir(), 'zoltar-ui-preact-'))
		try {
			for (const dependencyPath of preactSingletonDependencyPaths) {
				await mkdir(join(temporaryRoot, 'node_modules', dependencyPath), { recursive: true })
				for (const packageId of uiPackageIds) await mkdir(join(temporaryRoot, 'ui', packageId, 'node_modules', dependencyPath), { recursive: true })
			}

			await ensureUiPreactSingleton(temporaryRoot)
			await ensureUiPreactSingleton(temporaryRoot)

			for (const dependencyPath of preactSingletonDependencyPaths) {
				const rootDependencyPath = join(temporaryRoot, 'node_modules', dependencyPath)
				for (const packageId of uiPackageIds) expect(await realpath(join(temporaryRoot, 'ui', packageId, 'node_modules', dependencyPath))).toBe(rootDependencyPath)
			}
		} finally {
			await rm(temporaryRoot, { force: true, recursive: true })
		}
	})
})
