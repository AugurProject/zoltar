import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { format, getFileInfo, resolveConfig } from 'prettier'

const files = JSON.parse(readFileSync(0, 'utf8'))
if (!Array.isArray(files) || !files.every(file => typeof file === 'string')) throw new Error('Expected a list of Solidity file paths')
const config = fileURLToPath(new URL('../../.prettierrc.json', import.meta.url))
const ignorePath = ['../../.gitignore', '../../.prettierignore'].map(file => fileURLToPath(new URL(file, import.meta.url)))
const formatted = []
for (const file of files) {
	const source = await readFile(file, 'utf8')
	if ((await getFileInfo(file, { ignorePath })).ignored) {
		formatted.push(source)
		continue
	}
	const options = await resolveConfig(file, { config })
	formatted.push(await format(source, { ...options, filepath: file }))
}
process.stdout.write(JSON.stringify(formatted))
