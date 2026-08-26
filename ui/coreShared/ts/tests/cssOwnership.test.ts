import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const cssRoot = 'ui/coreShared/css'

function readStylesheet(name: string) {
	return readFileSync(`${cssRoot}/${name}`, 'utf8')
}

test('core shared stylesheet partitions begin at cohesive ownership boundaries', () => {
	expect(readStylesheet('index.css')).toBe(['@import url("./base.css");', '@import url("./protocol-surfaces.css");', '@import url("./reporting-visualizations.css");', '@import url("./application-surfaces.css");', '@import url("./controls-and-responsive.css");', ''].join('\n'))
	expect(readStylesheet('protocol-surfaces.css')).toStartWith('.entity-card {')
	expect(readStylesheet('reporting-visualizations.css')).toStartWith('.escalation-metrics {')
	expect(readStylesheet('application-surfaces.css')).toStartWith('.route-shell {')
	expect(readStylesheet('controls-and-responsive.css')).toStartWith('.view-tabs {')
})
