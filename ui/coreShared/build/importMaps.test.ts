import { expect, test } from 'bun:test'
import * as fs from 'node:fs'
import { UI_APP_IDS, getUiAppPaths } from './appPaths.mts'

type ImportMapFile = {
	imports?: Record<string, string>
}

const IMPORT_MAP_SCRIPT_PATTERN = /<script\s+type=['"]importmap['"][^>]*>([\s\S]*?)<\/script>/g

function readImportMaps(indexHtmlPath: string) {
	const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8')
	const importMaps: Record<string, string>[] = []
	for (const match of indexHtml.matchAll(IMPORT_MAP_SCRIPT_PATTERN)) {
		const scriptBody = match[1]
		if (scriptBody === undefined) continue
		let importMap: ImportMapFile
		try {
			importMap = JSON.parse(scriptBody) as ImportMapFile
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`Failed to parse the import map in ${indexHtmlPath} as JSON: ${message}`)
		}
		if (importMap.imports === undefined) throw new Error(`Expected the import map in ${indexHtmlPath} to include imports.`)
		importMaps.push(importMap.imports)
	}
	if (importMaps.length === 0) throw new Error(`Expected ${indexHtmlPath} to contain a development import map script.`)
	return importMaps
}

for (const appId of UI_APP_IDS) {
	const paths = getUiAppPaths(appId)

	test(`${appId}/index.html import maps are valid JSON with required mappings`, () => {
		const importMaps = readImportMaps(paths.appIndexHtml)
		expect(importMaps).toHaveLength(1)
		const imports = importMaps[0]
		if (imports === undefined) throw new Error('unreachable')

		expect(imports['preact']).toBe('./vendor/preact/preact.module.js')
		expect(imports['preact/hooks']).toBe('./vendor/preact/hooks/hooks.module.js')
		expect(imports['@preact/signals']).toBe('./vendor/@preact/signals/signals.module.js')
		expect(imports['@zoltar/shared/bigInt']).toBe('../shared/js/bigInt.js')
		expect(imports['@zoltar/shared/ethereum']).toBe('../shared/js/ethereum.js')
		expect(imports['tevm']).toBe('./vendor/tevm/index.js')
		expect(imports['@zoltar/ui-core-shared/']).toBe('/ui/coreShared/js/')
		if (appId === 'statoblast' || appId === 'trading') {
			expect(imports['@zoltar/ui-zoltar/']).toBe('/ui/zoltar/js/')
		} else {
			expect(imports['@zoltar/ui-zoltar/']).toBeUndefined()
		}
		if (appId === 'trading') {
			expect(imports['@zoltar/ui-statoblast/']).toBe('/ui/statoblast/js/')
			expect(imports['@zoltar/shared/trading/math']).toBe('../shared/js/trading/math.js')
			expect(imports['@zoltar/shared/trading/positions']).toBe('../shared/js/trading/positions.js')
			expect(imports['@zoltar/shared/trading/transactions']).toBe('../shared/js/trading/transactions.js')
		}

		for (const mappedPath of Object.values(imports)) {
			expect(mappedPath.endsWith(',') || mappedPath.endsWith('}')).toBe(false)
		}
	})
}
