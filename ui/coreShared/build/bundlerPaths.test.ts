import { expect, test } from 'bun:test'
import { normalizeBundlerPath, resolveBundlerPackageRootPath, resolveBundlerSpecifierPath } from './bundlerPaths.mts'

test('normalizeBundlerPath converts Windows separators to forward slashes', () => {
	expect(normalizeBundlerPath('C:\\projects\\zoltar\\ui\\node_modules\\tevm\\index.js')).toBe('C:/projects/zoltar/ui/node_modules/tevm/index.js')
	expect(normalizeBundlerPath('/workspace/zoltar/ui/node_modules/tevm/index.js')).toBe('/workspace/zoltar/ui/node_modules/tevm/index.js')
})

test('resolveBundlerSpecifierPath returns normalized package export paths', () => {
	const resolvedPaths = {
		tevm: resolveBundlerSpecifierPath('tevm'),
		tevmCommon: resolveBundlerSpecifierPath('tevm/common'),
		tevmMemoryClient: resolveBundlerSpecifierPath('@tevm/memory-client'),
		atTevmCommon: resolveBundlerSpecifierPath('@tevm/common'),
	}

	expect(resolvedPaths.tevm).toMatch(/\/node_modules\/tevm\/index\.js$/)
	expect(resolvedPaths.tevmCommon).toMatch(/\/node_modules\/tevm\/common\/index\.js$/)
	expect(resolvedPaths.tevmMemoryClient).toMatch(/\/node_modules\/@tevm\/memory-client\/dist\/index\.js$/)
	expect(resolvedPaths.atTevmCommon).toMatch(/\/node_modules\/@tevm\/common\/dist\/index\.js$/)

	for (const resolvedPath of Object.values(resolvedPaths)) {
		expect(resolvedPath).not.toContain('\\')
	}
})

test('resolveBundlerPackageRootPath returns the installed package root for direct and subpath specifiers', () => {
	expect(resolveBundlerPackageRootPath('preact')).toMatch(/\/node_modules\/preact$/)
	expect(resolveBundlerPackageRootPath('preact/hooks')).toMatch(/\/node_modules\/preact$/)
	expect(resolveBundlerPackageRootPath('@tevm/common')).toMatch(/\/node_modules\/@tevm\/common$/)
})
