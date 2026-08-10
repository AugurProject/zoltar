import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')
const sourceRoots = ['scripts', 'ts', 'ui/build', 'ui/ts']
const sourceExtensions = new Set(['.cts', '.mts', '.ts', '.tsx'])
const forbidden = new RegExp(String.raw`\bNum` + String.raw`ber\s*\(`, 'u')
const violations: string[] = []

async function inspect(relativePath: string): Promise<void> {
	const absolutePath = path.join(projectRoot, relativePath)
	const entries = await readdir(absolutePath, { withFileTypes: true })
	for (const entry of entries) {
		const child = path.join(relativePath, entry.name)
		if (entry.isDirectory()) {
			if (entry.name !== 'artifacts' && entry.name !== 'generated') await inspect(child)
			continue
		}
		if (!sourceExtensions.has(path.extname(entry.name))) continue
		const contents = await readFile(path.join(projectRoot, child), 'utf8')
		for (const [index, line] of contents.split('\n').entries()) {
			if (forbidden.test(line)) violations.push(`${child}:${(index + 1).toString()}`)
		}
	}
}

for (const root of sourceRoots) await inspect(root)
if (violations.length > 0) throw new Error(`Direct Number constructor casts are forbidden in trading sources:\n${violations.join('\n')}`)
console.log('Validated trading sources contain no direct Number constructor casts')
