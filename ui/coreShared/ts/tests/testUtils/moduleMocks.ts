import { afterAll, mock } from 'bun:test'
import { fileURLToPath } from 'node:url'

type ModuleExports = Record<string, unknown>

type ModuleMockScope = {
	/**
	 * Replaces the named exports of a module for the rest of the scope. Exports the factory does not
	 * return keep their actual implementation.
	 */
	mockModule: (specifier: string, factory: (actual: ModuleExports) => ModuleExports) => Promise<void>
	/** Re-registers every mocked module with the exports it had before the first replacement. */
	restoreModuleMocks: () => void
}

/**
 * Resolves a module specifier from the calling test file. Pass `specifier => import.meta.resolve(specifier)`
 * so package and relative specifiers resolve exactly as the test's own imports do.
 */
type ResolveModuleSpecifier = (specifier: string) => string

/**
 * Bun's `mock.module` installs a process-wide replacement that `mock.restore()` does not undo, so a
 * module mock left behind by one test file leaks into every later file that runs in the same process.
 * Bun also rewrites the live bindings of modules that already imported the target, which means the
 * actual exports have to be captured before the first replacement and re-registered afterwards.
 *
 * Registrations are keyed by the resolved module path, so the caller's resolver decides which module
 * instance is replaced; this file cannot resolve sibling workspace packages on the caller's behalf.
 */
function createModuleMockScope(resolveModuleSpecifier: ResolveModuleSpecifier): ModuleMockScope {
	const actualExportsByPath = new Map<string, ModuleExports>()

	return {
		mockModule: async (specifier, factory) => {
			const modulePath = fileURLToPath(resolveModuleSpecifier(specifier))
			let actualExports = actualExportsByPath.get(modulePath)
			if (actualExports === undefined) {
				actualExports = { ...(await import(modulePath)) }
				actualExportsByPath.set(modulePath, actualExports)
			}
			const overrides = factory(actualExports)
			mock.module(modulePath, () => ({ ...actualExports, ...overrides }))
		},
		restoreModuleMocks: () => {
			for (const [modulePath, actualExports] of actualExportsByPath) {
				mock.module(modulePath, () => ({ ...actualExports }))
			}
		},
	}
}

/**
 * Creates a module mock scope whose mocks are restored once the enclosing file or `describe` finishes.
 * Call it as `installModuleMocks(specifier => import.meta.resolve(specifier))` from the test file.
 */
export function installModuleMocks(resolveModuleSpecifier: ResolveModuleSpecifier) {
	const scope = createModuleMockScope(resolveModuleSpecifier)
	afterAll(() => {
		scope.restoreModuleMocks()
	})
	return scope
}
