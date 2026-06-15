import * as path from 'path'
import * as url from 'url'
import { promises as fs } from 'fs'
import * as process from 'node:process'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const UI_ROOT_PATH = path.join(directoryOfThisFile, '..')
const TEST_SOURCE_ROOT_PATH = path.join(UI_ROOT_PATH, 'ts', 'tests')
const TEST_OUTPUT_ROOT_PATH = path.join(UI_ROOT_PATH, 'js', 'tests')

async function getAllFiles(dirPath: string, fileList: string[] = []) {
	const entries = await fs.readdir(dirPath, { withFileTypes: true })
	for (const entry of entries) {
		const entryPath = path.join(dirPath, entry.name)
		if (entry.isDirectory()) {
			await getAllFiles(entryPath, fileList)
		} else {
			fileList.push(entryPath)
		}
	}
	return fileList
}

async function buildTests() {
	const testFiles = (await getAllFiles(TEST_SOURCE_ROOT_PATH)).filter(filePath => filePath.endsWith('.ts') || filePath.endsWith('.tsx'))
	await fs.rm(TEST_OUTPUT_ROOT_PATH, { recursive: true, force: true })
	await fs.mkdir(TEST_OUTPUT_ROOT_PATH, { recursive: true })
	for (const testFile of testFiles) {
		const source = await fs.readFile(testFile, 'utf8')
		const loader = path.extname(testFile) === '.tsx' ? 'tsx' : 'ts'
		let transformSource = source
		if (loader === 'tsx' && !/\bimport\s*\{[^}]*\bh\b[^}]*\}\s*from\s*['"]preact['"]/.test(source)) {
			transformSource = `import { h } from 'preact'\n${source}`
		}
		const code = await new Bun.Transpiler({
			loader,
			tsconfig: {
				compilerOptions: {
					jsx: 'react',
					jsxFactory: 'h',
					jsxFragmentFactory: 'Fragment',
				},
			},
		}).transform(transformSource)
		const outputFile = path.join(TEST_OUTPUT_ROOT_PATH, `${path.relative(TEST_SOURCE_ROOT_PATH, testFile).replace(/\.[^.]+$/, '')}.js`)
		await fs.mkdir(path.dirname(outputFile), { recursive: true })
		await fs.writeFile(outputFile, code)
	}
}

buildTests().catch(error => {
	console.error(error)
	process.exit(1)
})
