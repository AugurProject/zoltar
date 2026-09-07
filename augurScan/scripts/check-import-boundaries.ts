import { importBoundaryViolations } from './import-boundaries.ts'

const sources = new Map<string, string>()
for (const file of new Bun.Glob('src/**/*.ts').scanSync({ cwd: `${import.meta.dir}/..`, onlyFiles: true }))
	sources.set(file, await Bun.file(new URL(`../${file}`, import.meta.url)).text())

const violations = importBoundaryViolations(sources)
if (violations.length > 0) {
	for (const violation of violations) console.error(`${violation.file}: ${violation.reason}; imported ${violation.imported}`)
	throw new Error(`Found ${violations.length} AugurScan import-boundary violation${violations.length === 1 ? '' : 's'}`)
}

console.info(`Validated AugurScan capability boundaries across ${sources.size} production modules`)
