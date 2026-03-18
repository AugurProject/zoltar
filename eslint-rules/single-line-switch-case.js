module.exports = {
	meta: {
		type: 'layout',
		fixable: 'whitespace',
		schema: [],
		messages: {
			singleLine: 'Switch case without braces must stay on one line',
		},
	},

	create(context) {
		const sourceCode = context.getSourceCode()

		return {
			SwitchCase(node) {
				if (node.consequent.length !== 1) return

				const statement = node.consequent[0]
				if (statement.type === 'BlockStatement') return

				const colonToken = sourceCode.getTokenBefore(statement, token => token.value === ':')
				if (!colonToken) return

				const colonLine = colonToken.loc.end.line
				const statementLine = statement.loc.start.line

				if (colonLine === statementLine) return

				context.report({
					node: statement,
					messageId: 'singleLine',
					fix(fixer) {
						return fixer.replaceTextRange([colonToken.range[1], statement.range[0]], ' ')
					},
				})
			},
		}
	},
}
