import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { parseArgs } from 'node:util'
import { walkFiles } from '../repo/walk.mts'
import { computeScreenshotFingerprint, extractScreenshotReferences, findScreenshotProblems, type ImageSize, readPngSize, readScreenshotFingerprints, SCREENSHOT_DIRECTORY, screenshotAppIds } from './ui-screenshots.mts'

const repositoryRoot = path.resolve(import.meta.dir, '..', '..')
const toPosix = (filePath: string) => path.relative(repositoryRoot, filePath).split(path.sep).join('/')

const { values } = parseArgs({ options: { strict: { type: 'boolean' } } })

const pages = await walkFiles(path.join(repositoryRoot, 'docs'), { include: filePath => filePath.endsWith('.html'), descend: directoryPath => !directoryPath.endsWith(`${path.sep}assets`) })
const references = (await Promise.all(pages.map(async pagePath => extractScreenshotReferences(path.relative(path.join(repositoryRoot, 'docs'), pagePath).split(path.sep).join('/'), await fs.readFile(pagePath, 'utf8'))))).flat()

const screenshotRoot = path.join(repositoryRoot, SCREENSHOT_DIRECTORY)
const imagePaths = await walkFiles(screenshotRoot, { include: filePath => filePath.endsWith('.png') }).catch((error: unknown) => {
	if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
	throw error
})
const files = new Map<string, ImageSize>(await Promise.all(imagePaths.map(async imagePath => [toPosix(imagePath), readPngSize(await fs.readFile(imagePath))] as const)))

const problems = findScreenshotProblems({ files, references })

const recorded = await readScreenshotFingerprints(repositoryRoot)
const staleApps: string[] = []
for (const appId of screenshotAppIds()) {
	if (recorded[appId] !== (await computeScreenshotFingerprint(repositoryRoot, appId))) staleApps.push(appId)
}
const staleMessages = staleApps.map(appId => `The ${appId} UI or its screenshot specs changed since its documentation screenshots were captured. Run 'bun run docs:screenshots -- --app ${appId}', review the images and the pages that quote their labels, and commit the result.`)

if (problems.length > 0 || (values.strict === true && staleMessages.length > 0)) {
	console.error([...problems, ...(values.strict === true ? staleMessages : [])].map(problem => `- ${problem}`).join('\n'))
	process.exit(1)
}
for (const message of staleMessages) console.warn(`Warning: ${message}`)
console.log(`UI screenshots OK: ${files.size.toString()} images, ${references.length.toString()} embeds.`)
