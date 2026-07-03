import * as url from 'node:url'

// Bun's bundler resolves Windows filesystem paths more reliably with forward slashes.
export function normalizeBundlerPath(filePath: string) {
	return filePath.replaceAll('\\', '/')
}

export function resolveBundlerSpecifierPath(specifier: string) {
	return normalizeBundlerPath(url.fileURLToPath(import.meta.resolve(specifier)))
}

export function resolveBundlerPackageRootPath(specifier: string) {
	const resolvedPath = resolveBundlerSpecifierPath(specifier)
	const nodeModulesSegment = '/node_modules/'
	const nodeModulesIndex = resolvedPath.lastIndexOf(nodeModulesSegment)
	if (nodeModulesIndex === -1) {
		throw new Error(`Could not determine package root for ${specifier}`)
	}
	const packagePathStart = nodeModulesIndex + nodeModulesSegment.length
	const packagePath = resolvedPath.slice(packagePathStart)
	const packageSegments = packagePath.startsWith('@') ? 2 : 1
	const packageName = packagePath.split('/').slice(0, packageSegments).join('/')
	return resolvedPath.slice(0, packagePathStart + packageName.length)
}
