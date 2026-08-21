import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { UI_APP_IDS, getUiAppPaths, getUiCoreSharedPaths } from './appPaths.mts'

const { repositoryRoot } = getUiCoreSharedPaths()
const dockerfilePath = path.join(repositoryRoot, 'ui', 'Dockerfile')

const PUBLISHER_COPY_PATTERN = /^COPY --from=builder (\/source\/\S+?) (\/export\/\S+)$/gm

type PublisherExport = {
	readonly sourcePath: string
	readonly exportPath: string
}

function readPublisherExports(): PublisherExport[] {
	const dockerfile = fs.readFileSync(dockerfilePath, 'utf8')
	const exports: PublisherExport[] = []
	for (const match of dockerfile.matchAll(PUBLISHER_COPY_PATTERN)) {
		const sourcePath = match[1]
		const exportPath = match[2]
		if (sourcePath === undefined || exportPath === undefined) continue
		exports.push({ sourcePath, exportPath })
	}
	return exports
}

const HTML_REFERENCE_PATTERN = /(?:src|href)=["']([^"']+)["']/g

function readHtmlReferences(indexHtmlPath: string) {
	const html = fs.readFileSync(indexHtmlPath, 'utf8')
	const references: string[] = []
	for (const match of html.matchAll(HTML_REFERENCE_PATTERN)) {
		const reference = match[1]
		if (reference === undefined) continue
		if (reference.startsWith('http://') || reference.startsWith('https://') || reference.startsWith('data:') || reference.startsWith('#')) continue
		references.push(reference.replace(/^\.\//, '').replace(/^\//, ''))
	}
	return references
}

describe('IPFS publisher layout', () => {
	test('every app has an advertised export path in the publisher target', () => {
		const exports = readPublisherExports()
		const exportRoots = new Set(exports.map(entry => entry.exportPath.split('/').slice(0, 3).join('/')))
		for (const appId of UI_APP_IDS) {
			expect(exportRoots.has(`/export/${appId}`)).toBe(true)
		}
	})

	test('every advertised export path has an index.html and all referenced local assets', () => {
		const exports = readPublisherExports()
		for (const appId of UI_APP_IDS) {
			const appPaths = getUiAppPaths(appId)
			const advertisedRoot = `/export/${appId}`
			const advertisedExports = exports.filter(entry => entry.exportPath === advertisedRoot || entry.exportPath.startsWith(`${advertisedRoot}/`))
			expect(advertisedExports.length).toBeGreaterThan(0)

			// Map /export/<app>/... back onto the builder dist tree to prove the exported tree is servable.
			const exportedFiles = new Set<string>()
			for (const entry of advertisedExports) {
				const sourceRelative = entry.sourcePath.replace('/source/', '')
				const exportRelative = entry.exportPath.replace(`${advertisedRoot}/`, '')
				const sourceAbsolute = path.join(repositoryRoot, sourceRelative)
				if (entry.sourcePath.endsWith('/')) {
					// Directory copy: exportRelative is the directory name.
					expect(fs.existsSync(sourceAbsolute)).toBe(true)
					exportedFiles.add(exportRelative.replace(/\/$/, ''))
					continue
				}
				expect(fs.existsSync(sourceAbsolute)).toBe(true)
				exportedFiles.add(exportRelative)
			}

			expect(exportedFiles.has('index.html')).toBe(true)
			const distIndexHtml = path.join(appPaths.appDistRoot, 'index.html')
			expect(fs.existsSync(distIndexHtml)).toBe(true)
			for (const reference of readHtmlReferences(distIndexHtml)) {
				const topLevelDirectory = reference.split('/')[0]
				expect(exportedFiles.has(reference) || exportedFiles.has(reference.replace(/\/[^/]*$/, '')) || exportedFiles.has(topLevelDirectory ?? reference)).toBe(true)
			}
		}
	})
})
