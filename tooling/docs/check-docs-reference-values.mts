import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { getMainnetProtocolConfig } from '../contracts/protocol-config.ts'
import { walkFiles } from '../repo/walk.mts'
import { assertAccountingExampleOwnership } from './check-docs-example-ownership.mts'
import { htmlToDocumentationText } from './docs-html-text.mts'
import { assertCoordinatorDataEventAndEnumDeclarations, assertCoordinatorParameterTableValues, assertInvariantCatalogLifecycleBoundaries, assertInvariantIndexMatchesEntries } from './check-docs-catalog-declarations.mts'
import { assertCoordinatorDataFunctionInventory } from './contract-reference-abi-surface.mts'
import { repositorySourceUrl } from './repository-source-links.mts'

const normalizeHtmlSource = (source: string): string => source.replaceAll(/<\/([a-z][\w:-]*)\s+>/gi, '</$1>')
const invariantsHtml = normalizeHtmlSource(await readFile('docs/reference/invariants.html', 'utf8'))
const liquidationHtml = normalizeHtmlSource(await readFile('docs/explanation/liquidations.html', 'utf8'))
const openOracleIntegration = normalizeHtmlSource(await readFile('docs/reference/open-oracle.html', 'utf8'))
const whitepaperStatoblast = normalizeHtmlSource(await readFile('docs/explanation/statoblast.html', 'utf8'))
const coordinatorData = await readFile('docs/data/open-oracle-coordinator.json', 'utf8')
const compiledContractArtifacts: unknown = JSON.parse(await readFile('solidity/artifacts/Contracts.json', 'utf8'))
const operatorReference = (await Promise.all(['docs/reference/operator-guardrails.html', 'docs/reference/contract-inventory.html'].map(async pagePath => htmlToDocumentationText(await readFile(pagePath, 'utf8'))))).join('\n')
const contractInteractionReference = (await Promise.all(['docs/reference/contracts.html', ...[...new Bun.Glob('docs/reference/contracts/*.html').scanSync('.')].toSorted()].map(async pagePath => htmlToDocumentationText(await readFile(pagePath, 'utf8'))))).join('\n')
const priceCoordinator = `${await readFile('solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol', 'utf8')}\n${await readFile('solidity/contracts/statoblast/OpenOraclePriceSource.sol', 'utf8')}\n${await readFile('solidity/contracts/statoblast/OpenOracleReportDelegate.sol', 'utf8')}`
const priceCoordinatorTypes = await readFile('solidity/contracts/statoblast/OpenOraclePriceCoordinatorTypes.sol', 'utf8')
const openOracleSource = await readFile('solidity/contracts/statoblast/openOracle/OpenOracle.sol', 'utf8')
const openOracleProvenance = await readFile('solidity/contracts/statoblast/openOracle/UPSTREAM.md', 'utf8')
const zoltar = await readFile('solidity/contracts/Zoltar.sol', 'utf8')
const escalationGameBytecodeSnapshot = await readFile('solidity/ts/tests/fixtures/escalationGameBytecode.snapshot.json', 'utf8')

await assertNoNarrativeDocumentationSnapshots()
await assertAccountingExampleOwnership()
assertInvariantCatalogLifecycleBoundaries(invariantsHtml)
assertInvariantIndexMatchesEntries(invariantsHtml)
assertZoltarForkDepths()
assertRecursiveForkGasStatusDocs()
assertOpenOracleVendorAndEventDocs()
assertCoordinatorDataFunctionInventory(coordinatorData, compiledContractArtifacts)
assertCoordinatorDataEventAndEnumDeclarations(coordinatorData, compiledContractArtifacts, priceCoordinatorTypes)
await assertCoordinatorParameterTableValues(openOracleIntegration, priceCoordinator, priceCoordinatorTypes)
assertEscalationGameBytecodeDocs()
assertSolidityFunctionReader()
await assertProductionSolidityInventory()

async function assertNoNarrativeDocumentationSnapshots(): Promise<void> {
	const validatorPaths = ['tooling/docs/check-docs-examples.mts', 'tooling/docs/check-docs-example-ownership.mts', 'tooling/docs/check-docs-reference-values.mts']
	for (const validatorPath of validatorPaths) {
		const validatorSource = await readFile(validatorPath, 'utf8')
		assert.deepEqual(findNarrativeDocumentationAssertions(validatorSource, validatorPath), [], `${validatorPath} must validate documentation structure, formulas, generated data, or executable behavior without freezing narrative prose`)
	}

	const paraphraseFriendlyFixture = `assert.match(html, /id="purpose"/)`
	const formulaFixture = `assert.match(openOracleIntegration, /data-source="amount = principal \\cdot rate"/)`
	const narrativeFixture = `assert.match(html, /The mechanism always follows this exact sentence/)`
	const suffixedNarrativeFixture = `assert.match(feesHtml, /the fee starts low and rises/)`
	assert.deepEqual(findNarrativeDocumentationAssertions(paraphraseFriendlyFixture, 'paraphrase-fixture.mts'), [])
	assert.deepEqual(findNarrativeDocumentationAssertions(formulaFixture, 'formula-fixture.mts'), [])
	assert.equal(findNarrativeDocumentationAssertions(narrativeFixture, 'narrative-fixture.mts').length, 1)
	assert.equal(findNarrativeDocumentationAssertions(suffixedNarrativeFixture, 'suffixed-narrative-fixture.mts').length, 1)
}

function findNarrativeDocumentationAssertions(source: string, sourcePath: string): string[] {
	const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	const violations: string[] = []
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'assert') {
			const assertionName = node.expression.name.text
			if ((assertionName === 'match' || assertionName === 'doesNotMatch') && node.arguments.length >= 2 && isStaticDocumentationExpression(node.arguments[0])) {
				const pattern = node.arguments[1]?.getText(sourceFile) ?? ''
				if (!isStructuredDocumentationPattern(pattern)) violations.push(`${sourcePath}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`)
			}
			if (assertionName === 'ok' && node.arguments.length > 0 && isNarrativeDocumentationIncludes(node.arguments[0], sourceFile)) {
				violations.push(`${sourcePath}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`)
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)
	return violations
}

function isStaticDocumentationExpression(expression: ts.Expression | undefined): boolean {
	if (expression === undefined) return false
	if (ts.isIdentifier(expression)) {
		return (
			new Set(['html', 'invariantsHtml', 'liquidationHtml', 'openOracleIntegration', 'whitepaperStatoblast', 'operatorReference', 'contractInteractionReference', 'openOracleHtml', 'auctionDesignHtml', 'statoblastHtml', 'requestCostEquation']).has(expression.text) || /(?:Entry|Row|Html|Examples)$/.test(expression.text)
		)
	}
	return ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'blockWithId'
}

function isStructuredDocumentationPattern(pattern: string): boolean {
	if (/(?:data-source=|<mi>|<mn>)/.test(pattern)) return true
	if (/<(?:section|details) id=/.test(pattern) && !pattern.includes('[\\s\\S]')) return true
	return /(?:id|href|class)=/.test(pattern) && !pattern.includes(' ')
}

function isNarrativeDocumentationIncludes(expression: ts.Expression | undefined, sourceFile: ts.SourceFile): boolean {
	if (!expression || !ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression) || expression.expression.name.text !== 'includes') return false
	if (!isStaticDocumentationExpression(expression.expression.expression)) return false
	const argument = expression.arguments[0]
	if (argument === undefined) return false
	const argumentText = argument.getText(sourceFile)
	if (/^[`'"][A-Za-z_]\w*\([^`'"\n]*\)[`'"]$/.test(argumentText) || argumentText.includes('${') || argumentText.includes('/')) return false
	return /\s/.test(argumentText.slice(1, -1))
}

function assertEscalationGameBytecodeDocs(): void {
	const creationBytes = escalationGameBytecodeSnapshot.match(/"creationBytes":\s*(\d+)/)?.[1]
	const deployedBytes = escalationGameBytecodeSnapshot.match(/"deployedBytes":\s*(\d+)/)?.[1]
	assert.ok(creationBytes, 'EscalationGame bytecode snapshot must record creationBytes')
	assert.ok(deployedBytes, 'EscalationGame bytecode snapshot must record deployedBytes')
}

function assertZoltarForkDepths(): void {
	const protocolConfig = getMainnetProtocolConfig()
	assert.equal(protocolConfig.forkThresholdDivisor, 20n, 'Zoltar fork threshold divisor changed')
	assert.equal(protocolConfig.forkBurnDivisor, 5n, 'Zoltar fork burn divisor changed')
	assert.match(zoltar, /_forkBurnDivisor >= Constants\.MINIMUM_FORK_BURN_DIVISOR/)
	assert.match(zoltar, /theoreticalSupplyAttoRep \/ forkThresholdDivisor \+[\s\S]*theoreticalSupplyAttoRep % forkThresholdDivisor == 0 \? 0 : 1/)
	assert.match(zoltar, /uint256 migrationRepBalanceAttoRep = forkThresholdAttoRep - forkThresholdAttoRep \/ forkBurnDivisor;/)

	const nonDivisibleThreshold = 6n
	const haircut = nonDivisibleThreshold / protocolConfig.forkBurnDivisor
	const migrationCredit = nonDivisibleThreshold - haircut
	assert.equal(haircut, 1n, 'non-divisible fork threshold haircut must round down')
	assert.equal(migrationCredit, 5n, 'non-divisible fork threshold remainder must round the 80% migration credit up')
}

function assertRecursiveForkGasStatusDocs(): void {
	assert.match(invariantsHtml, /id="lifecycle"/)
}

function assertOpenOracleVendorAndEventDocs(): void {
	assert.equal(createHash('sha256').update(openOracleSource).digest('hex'), '7afa3edc2c0fb21ea560e67ad5220e461e9b5d3ef9dd68d18081ffef2d157728', 'Vendored OpenOracle source changed; compare it with the pinned openPunt revision and update the source fingerprint')
	for (const pinnedRevision of ['4e5cffb7203ccc5d47ab986d74c04796a8f51302', 'c64a1edb67b6e3f4a15cca8909c9482ad33a02b0', 'src/OpenOracleSlim.sol', 'OpenZeppelin Contracts v5.4.0']) {
		assert.ok(openOracleProvenance.includes(pinnedRevision), `OpenOracle provenance must retain ${pinnedRevision}`)
	}
	assert.match(liquidationHtml, /<section id="rule">/)
	assert.doesNotMatch(whitepaperStatoblast, /id="fig-statoblast-auction-clearing"/, 'whitepaper must delegate auction clearing to the canonical focused diagram')
}

async function assertProductionSolidityInventory(): Promise<void> {
	const inventoryDocuments = `${contractInteractionReference}\n${operatorReference}`
	for (const sourcePath of (await walkFiles('solidity/contracts', { include: file => file.endsWith('.sol') })).map(file => file.replaceAll('\\', '/')).sort()) {
		if (sourcePath.includes('/test/')) continue
		assert.ok(inventoryDocuments.includes(repositorySourceUrl(sourcePath)), `Contract and operator references must inventory production source ${sourcePath}`)
	}
}

function readSolidityFunctionBody(source: string, functionPrefix: string): string {
	const code = maskSolidityCommentsAndStrings(source)
	const functionIndex = code.indexOf(functionPrefix)
	assert.notEqual(functionIndex, -1, `Missing Solidity function ${functionPrefix}`)
	const openingBraceIndex = code.indexOf('{', functionIndex)
	assert.notEqual(openingBraceIndex, -1, `Missing opening brace for Solidity function ${functionPrefix}`)

	let depth = 0
	for (let index = openingBraceIndex; index < code.length; index++) {
		const character = code[index]
		if (character === '{') {
			depth++
			continue
		}
		if (character !== '}') continue
		depth--
		if (depth === 0) return code.slice(openingBraceIndex + 1, index)
	}
	throw new Error(`Missing closing brace for Solidity function ${functionPrefix}`)
}

function maskSolidityCommentsAndStrings(source: string): string {
	const characters = source.split('')
	let blockComment = false
	let lineComment = false
	let quote: '"' | "'" | undefined
	for (let index = 0; index < characters.length; index++) {
		const character = characters[index]
		const nextCharacter = characters[index + 1]
		if (lineComment) {
			if (character === '\n') lineComment = false
			else characters[index] = ' '
			continue
		}
		if (blockComment) {
			if (character === '*' && nextCharacter === '/') {
				characters[index] = ' '
				characters[index + 1] = ' '
				blockComment = false
				index++
			} else if (character !== '\n') {
				characters[index] = ' '
			}
			continue
		}
		if (quote !== undefined) {
			characters[index] = character === '\n' ? '\n' : ' '
			if (character === '\\') {
				if (nextCharacter !== undefined) characters[index + 1] = ' '
				index++
			} else if (character === quote) {
				quote = undefined
			}
			continue
		}
		if (character === '/' && nextCharacter === '/') {
			characters[index] = ' '
			characters[index + 1] = ' '
			lineComment = true
			index++
			continue
		}
		if (character === '/' && nextCharacter === '*') {
			characters[index] = ' '
			characters[index + 1] = ' '
			blockComment = true
			index++
			continue
		}
		if (character === '"' || character === "'") {
			characters[index] = ' '
			quote = character
		}
	}
	return characters.join('')
}

function assertCallOrder(functionBody: string, firstCall: string, secondCall: string, message: string): void {
	const firstIndex = functionBody.indexOf(firstCall)
	const secondIndex = functionBody.indexOf(secondCall)
	assert.notEqual(firstIndex, -1, `${message}: missing ${firstCall}`)
	assert.notEqual(secondIndex, -1, `${message}: missing ${secondCall}`)
	assert.ok(firstIndex < secondIndex, message)
}

function assertSolidityFunctionReader(): void {
	const fixtureBody = readSolidityFunctionBody(
		`function fixture() /* { secondCall(); } */ {
			firstCall();
			string memory ignored = "secondCall(); }";
			// secondCall();
			secondCall();
		}`,
		'function fixture(',
	)
	assertCallOrder(fixtureBody, 'firstCall()', 'secondCall()', 'fixture calls must retain source order')

	const commentedCallBody = readSolidityFunctionBody(
		`function fixture() {
			firstCall();
			// secondCall();
			string memory ignored = "secondCall()";
		}`,
		'function fixture(',
	)
	assert.throws(() => assertCallOrder(commentedCallBody, 'firstCall()', 'secondCall()', 'commented calls must not satisfy order checks'))
}
