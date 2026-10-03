import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const styles = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8')

// The CSP blocks the style element Plot injects, so the stylesheet carries those rules under Plot's generated default class name, which changes between Plot versions.
test("the stylesheet targets the installed Plot's default class name", async () => {
	const plotStyleSource = await readFile(path.join(path.dirname(Bun.resolveSync('@observablehq/plot', import.meta.dir)), 'style.js'), 'utf8')
	const defaultClassName = /if \(name === undefined\) return "([\w-]+)"/u.exec(plotStyleSource)?.[1]
	if (defaultClassName === undefined) throw new Error('Could not find the default Plot class name')
	expect(styles).toContain(`:where(.${defaultClassName})`)
	expect(styles).toContain(`.${defaultClassName}-swatches-wrap`)
})
