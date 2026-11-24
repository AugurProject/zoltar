import * as ts from 'typescript'

function isDeclareStatement(statement: ts.Statement) {
	return ts.canHaveModifiers(statement) && (ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword) ?? false)
}

export function hasRuntimeStatement(statement: ts.Statement): boolean {
	if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || (ts.isImportEqualsDeclaration(statement) && statement.isTypeOnly)) return false
	if (ts.isImportDeclaration(statement)) {
		if (statement.importClause === undefined) return true
		if (statement.importClause.isTypeOnly) return false
		if (statement.importClause.name !== undefined) return true
		const bindings = statement.importClause.namedBindings
		if (bindings === undefined || ts.isNamespaceImport(bindings)) return true
		return bindings.elements.some(element => !element.isTypeOnly)
	}
	if (ts.isExportDeclaration(statement)) return !statement.isTypeOnly && (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause) || statement.exportClause.elements.some(element => !element.isTypeOnly))
	if (ts.isFunctionDeclaration(statement)) return statement.body !== undefined
	if (ts.isVariableStatement(statement)) return !isDeclareStatement(statement)
	if (ts.isModuleDeclaration(statement)) return !isDeclareStatement(statement)
	if (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) return !isDeclareStatement(statement)
	return !ts.isEmptyStatement(statement)
}
