import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')
const approvedBoundaries = new Set(['src/viem-runtime.js', 'src/viem-runtime.d.ts'])
const sourceExtensions = new Set(['.ts', '.js', '.mts', '.mjs', '.cts', '.cjs'])
const directViemImport = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\()\s*['"]viem(?:\/[^'"]*)?['"]/

const providerPackage = 'vie' + 'm'
for (const fixture of [
	`import '${providerPackage}'`,
	`import('${providerPackage}/actions')`,
	`export { getAddress } from '${providerPackage}'`,
	`const provider = require('${providerPackage}')`,
]) {
	if (!directViemImport.test(fixture)) throw new Error(`Ethereum boundary checker missed fixture: ${fixture}`)
}
if (directViemImport.test("import { render } from './view.js'")) throw new Error('Ethereum boundary checker rejected an unrelated import')

const files: string[] = []
const visit = async (directory: string): Promise<void> => {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name)
		if (entry.isDirectory()) {
			await visit(absolute)
			continue
		}
		if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) files.push(path.relative(projectRoot, absolute))
	}
}

for (const directory of ['src', 'scripts', 'tests', 'public']) await visit(path.join(projectRoot, directory))

const violations: string[] = []
for (const file of files) {
	const source = await readFile(path.join(projectRoot, file), 'utf8')
	if (directViemImport.test(source) && !approvedBoundaries.has(file)) violations.push(file)
}

for (const boundary of approvedBoundaries) {
	const source = await readFile(path.join(projectRoot, boundary), 'utf8')
	if (!directViemImport.test(source)) throw new Error(`${boundary} no longer defines the scanner Ethereum provider boundary`)
}
if (violations.length > 0) throw new Error(`Import Ethereum primitives through src/ethereum.ts; direct viem imports found in: ${violations.join(', ')}`)

console.log(`Validated the isolated Ethereum provider boundary across ${files.length} source files`)
