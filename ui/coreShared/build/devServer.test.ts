import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

test('development server explicitly binds to IPv4 loopback', async () => {
	const source = await readFile(new URL('../dev-server.ts', import.meta.url), 'utf8')
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
