import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { UiAppId } from '../ui/appPaths.mts'
import { UI_SCREENSHOT_APPS, UI_SCREENSHOTS, type UiScreenshotApp, type UiScreenshotSpec } from './ui-screenshot-specs.mts'

export const SCREENSHOT_DIRECTORY = 'docs/assets/screenshots'
export const SCREENSHOT_FINGERPRINT_PATH = `${SCREENSHOT_DIRECTORY}/fingerprints.json`

const IGNORED_DIRECTORIES = new Set(['js', 'node_modules', 'tests', 'vendor'])

export const screenshotOutputPath = (spec: Pick<UiScreenshotSpec, 'app' | 'id'>) => `${SCREENSHOT_DIRECTORY}/${spec.app}/${spec.id}.png`

export function screenshotApp(appId: UiAppId): UiScreenshotApp {
	const app = UI_SCREENSHOT_APPS[appId]
	if (app === undefined) throw new Error(`No screenshot configuration for UI app '${appId}'. Add it to UI_SCREENSHOT_APPS in tooling/docs/ui-screenshot-specs.mts.`)
	return app
}

const isIgnoredSourcePath = (filePath: string) => filePath.split('/').some(segment => IGNORED_DIRECTORIES.has(segment)) || /\.test\.tsx?$/.test(filePath)

/** Whether a repository path can change the rendered UI of `appId`, and therefore its documentation screenshots. */
export const isScreenshotSourcePath = (appId: UiAppId, filePath: string) => !isIgnoredSourcePath(filePath) && screenshotApp(appId).sourceRoots.some(root => filePath === root || filePath.startsWith(`${root}/`))

export const screenshotAppIds = (specs: readonly UiScreenshotSpec[] = UI_SCREENSHOTS): UiAppId[] => [...new Set(specs.map(spec => spec.app))].sort()

/** Tracked source files only: generated artifacts differ between checkouts and must not affect the fingerprint. */
function listTrackedSourceFiles(rootPath: string, appId: UiAppId) {
	const output = execFileSync('git', ['ls-files', '-z', '--', ...screenshotApp(appId).sourceRoots], { cwd: rootPath, encoding: 'utf8' })
	return output
		.split('\0')
		.filter(file => file !== '' && isScreenshotSourcePath(appId, file))
		.sort()
}

/** Hashes the app's rendering sources and its screenshot specs; a changed value means the screenshots may be stale. */
export async function computeScreenshotFingerprint(rootPath: string, appId: UiAppId, specs: readonly UiScreenshotSpec[] = UI_SCREENSHOTS): Promise<string> {
	const hash = createHash('sha256')
	hash.update(JSON.stringify(specs.filter(spec => spec.app === appId)))
	for (const file of listTrackedSourceFiles(rootPath, appId)) {
		hash.update(`\0${file}\0`)
		// Line endings depend on the checkout, not the source.
		hash.update((await fs.readFile(path.join(rootPath, file), 'utf8')).replaceAll('\r\n', '\n'))
	}
	return hash.digest('hex')
}

export async function readScreenshotFingerprints(rootPath: string): Promise<Record<string, string>> {
	const content = await fs.readFile(path.join(rootPath, SCREENSHOT_FINGERPRINT_PATH), 'utf8').catch((error: unknown) => {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '{}'
		throw error
	})
	const parsed: unknown = JSON.parse(content)
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${SCREENSHOT_FINGERPRINT_PATH} must contain a JSON object`)
	return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]))
}

export type ScreenshotReference = { readonly page: string; readonly src: string; readonly alt: string; readonly width: string | undefined; readonly height: string | undefined }
export type ImageSize = { readonly width: number; readonly height: number }

/** Reads the pixel size from a PNG header. */
export function readPngSize(bytes: Uint8Array): ImageSize {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
	if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) throw new Error('Not a PNG file')
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** Validates specs, generated files, and page references without launching a browser. */
export function findScreenshotProblems({ files, references, specs = UI_SCREENSHOTS }: { readonly files: ReadonlyMap<string, ImageSize>; readonly references: readonly ScreenshotReference[]; readonly specs?: readonly UiScreenshotSpec[] }): string[] {
	const problems: string[] = []
	const specsByPath = new Map<string, UiScreenshotSpec>()
	for (const spec of specs) {
		const outputPath = screenshotOutputPath(spec)
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spec.id)) problems.push(`Screenshot id '${spec.id}' must be kebab-case.`)
		if (specsByPath.has(outputPath)) problems.push(`Duplicate screenshot '${spec.app}/${spec.id}'.`)
		specsByPath.set(outputPath, spec)
		if (!files.has(outputPath)) problems.push(`${outputPath} is missing; run 'bun run docs:screenshots -- --app ${spec.app}'.`)
		if (spec.usedBy.length === 0) problems.push(`Screenshot '${spec.app}/${spec.id}' is not used by any page.`)
		for (const page of spec.usedBy) {
			if (!references.some(reference => reference.page === page && reference.src === outputPath)) problems.push(`Screenshot '${spec.app}/${spec.id}' lists docs/${page} in usedBy, but that page does not embed ${outputPath}.`)
		}
	}
	for (const reference of references) {
		const spec = specsByPath.get(reference.src)
		if (spec === undefined) problems.push(`docs/${reference.page} embeds ${reference.src}, which no entry in tooling/docs/ui-screenshot-specs.mts produces.`)
		else if (!spec.usedBy.includes(reference.page)) problems.push(`docs/${reference.page} embeds ${reference.src}; add the page to that screenshot's usedBy list.`)
		if (reference.alt.trim() === '') problems.push(`docs/${reference.page} embeds ${reference.src} without alt text.`)
		const size = files.get(reference.src)
		if (size !== undefined && (reference.width !== size.width.toString() || reference.height !== size.height.toString())) {
			problems.push(`docs/${reference.page} embeds ${reference.src} with width="${reference.width ?? ''}" height="${reference.height ?? ''}", but the image is ${size.width.toString()}x${size.height.toString()}; run 'bun run docs:screenshots -- --app ${spec?.app ?? '<app>'}' to update the attributes.`)
		}
	}
	for (const file of files.keys()) {
		if (!specsByPath.has(file)) problems.push(`${file} is not produced by any screenshot spec; delete it.`)
	}
	return problems
}

const IMG_TAG_PATTERN = /<img\b[^>]*>/g
const attributeValue = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]

/** Resolves a page-relative image source to a repository path. */
const resolveDocsSource = (page: string, src: string) => path.posix.join('docs', path.posix.dirname(page), src)

/** Lists the screenshot images a page embeds. */
export function extractScreenshotReferences(page: string, html: string): ScreenshotReference[] {
	return [...html.matchAll(IMG_TAG_PATTERN)].flatMap(([tag]) => {
		const src = attributeValue(tag, 'src')
		if (src === undefined) return []
		const resolved = resolveDocsSource(page, src)
		if (!resolved.startsWith(`${SCREENSHOT_DIRECTORY}/`)) return []
		return [{ page, src: resolved, alt: attributeValue(tag, 'alt') ?? '', width: attributeValue(tag, 'width'), height: attributeValue(tag, 'height') }]
	})
}

/** Rewrites width and height of every `<img>` on the page that embeds `outputPath`. */
export function withScreenshotSize(page: string, html: string, outputPath: string, size: ImageSize): string {
	return html.replace(IMG_TAG_PATTERN, tag => {
		const src = attributeValue(tag, 'src')
		if (src === undefined || resolveDocsSource(page, src) !== outputPath) return tag
		const withoutSize = tag.replace(/\s(?:width|height)="[^"]*"/g, '')
		return withoutSize.replace(/^<img\b/, `<img width="${size.width.toString()}" height="${size.height.toString()}"`)
	})
}
