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
		expect(imports['@zoltar/core-shared/serialization/bigInt']).toBe('../shared/core/js/serialization/bigInt.js')
		expect(imports['@zoltar/core-shared/evm/ethereum']).toBe('../shared/core/js/evm/ethereum.js')
		expect(imports['@zoltar/core-shared/evm/logScan']).toBe('../shared/core/js/evm/logScan.js')
		expect(imports['@zoltar/zoltar-shared/questions/scalarOutcome']).toBe('../shared/zoltar/js/questions/scalarOutcome.js')
		expect(imports['@tevm/memory-client']).toBe('./vendor/tevm/index.js')
		expect(imports['@tevm/common']).toBe('./vendor/tevm/common/index.js')
		expect(imports['@zoltar/ui-core-shared/']).toBe('/ui/coreShared/js/')
		expect(imports['@zoltar/ui-zoltar-shared/']).toBe('/ui/zoltarShared/js/')
		if (appId === 'statoblast' || appId === 'trading') expect(imports['@zoltar/ui-statoblast-shared/']).toBe('/ui/statoblastShared/js/')
		else expect(imports['@zoltar/ui-statoblast-shared/']).toBeUndefined()
		if (appId === 'trading') {
			expect(imports['@zoltar/trading-shared/trading/math']).toBe('../shared/trading/js/trading/math.js')
			expect(imports['@zoltar/trading-shared/trading/positions']).toBe('../shared/trading/js/trading/positions.js')
			expect(imports['@zoltar/trading-shared/trading/transactions']).toBe('../shared/trading/js/trading/transactions.js')
		}
		expect(imports['@zoltar/ui-trading-shared']).toBeUndefined()
		expect(imports['@zoltar/ui-trading-shared/']).toBeUndefined()

		for (const mappedPath of Object.values(imports)) {
			expect(mappedPath.endsWith(',') || mappedPath.endsWith('}')).toBe(false)
		}
	})
}
