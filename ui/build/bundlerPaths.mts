import * as url from 'node:url'

// Bun's bundler resolves Windows filesystem paths more reliably with forward slashes.
export function normalizeBundlerPath(filePath: string) {
	return filePath.replaceAll('\\', '/')
}

export function resolveBundlerSpecifierPath(specifier: string) {
	return normalizeBundlerPath(url.fileURLToPath(import.meta.resolve(specifier)))
}
