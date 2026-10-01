import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import ts from 'typescript'
import { getDevServerMimeType } from './devServerMimeTypes.mts'
import { getServedFilePaths } from './devServerRequests.mts'

test('development server explicitly binds to IPv4 loopback', async () => {
	const source = await readFile(new URL('./dev-server.ts', import.meta.url), 'utf8')
	const sourceFile = ts.createSourceFile('dev-server.ts', source, ts.ScriptTarget.Latest, true)
	const listenCalls: ts.CallExpression[] = []
	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'server' && node.expression.name.text === 'listen') listenCalls.push(node)
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)

	// Check the binding configuration without opening a network listener.
	expect(listenCalls).toHaveLength(1)
	const host = listenCalls[0]?.arguments[1]
	if (host === undefined || !ts.isStringLiteral(host)) throw new Error('Development server must specify a literal loopback bind address')
	expect(host.text).toBe('127.0.0.1')
})

test('development server resolves files inside the app root first and never outside the configured roots', () => {
	const roots = { repositoryRootDirectory: path.resolve('/repository'), uiRootDirectory: path.resolve('/repository/ui/zoltar') }
	expect(getServedFilePaths('/', roots)).toEqual([path.resolve('/repository/ui/zoltar/index.html'), path.resolve('/repository/index.html')])
	expect(getServedFilePaths('/js/index.js', roots)).toEqual([path.resolve('/repository/ui/zoltar/js/index.js'), path.resolve('/repository/js/index.js')])
	expect(getServedFilePaths('/shared/core/js/index.js', roots)).toEqual([path.resolve('/repository/shared/core/js/index.js')])
	expect(getServedFilePaths('/../outside.txt', roots)).toEqual([])
	expect(getServedFilePaths('/%2E%2E/outside.txt', roots)).toEqual([])
	expect(getServedFilePaths('/../zoltar/index.html', roots)).toEqual([path.resolve('/repository/ui/zoltar/index.html')])
})

test('development server maps file extensions to MIME types and omits unknown types', () => {
	expect(getDevServerMimeType('/app/index.html')).toBe('text/html')
	expect(getDevServerMimeType('/app/js/index.mjs')).toBe('text/javascript')
	expect(getDevServerMimeType('/app/css/app.css')).toBe('text/css')
	expect(getDevServerMimeType('/app/vendor/module.wasm')).toBe('application/wasm')
	expect(getDevServerMimeType('/app/data.json')).toBe('application/json')
	expect(getDevServerMimeType('/app/icon.svg')).toBe('image/svg+xml')
	expect(getDevServerMimeType('/app/archive.unknown-extension')).toBeUndefined()
})
