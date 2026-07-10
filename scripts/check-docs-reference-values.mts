import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { getMainnetProtocolConfig } from '../shared/ts/protocolConfig'

const html = await readFile('docs/escalation-game-architecture.html', 'utf8')
const zoltarWhitepaper = await readFile('docs/whitepaper_zoltar.html', 'utf8')
const bytecodeSnapshot = readBytecodeSnapshot(await readFile('solidity/ts/tests/fixtures/escalationGameBytecode.snapshot.json', 'utf8'))
const interfaceRegressionTest = await readFile('solidity/ts/tests/escalationGameInterfaceRegression.test.ts', 'utf8')

const expectedProjectBudget = readNumericConstant(interfaceRegressionTest, 'escalationGameDeployedBytecodeBudgetBytes')
const expectedEip170Budget = readNumericConstant(interfaceRegressionTest, 'eip170DeployedBytecodeLimitBytes')

assertSimpleByteRow('Creation bytecode', formatNumber(bytecodeSnapshot.creationBytes))
assertSimpleByteRow('Deployed bytecode', formatNumber(bytecodeSnapshot.deployedBytes))
assertBudgetHeadroomRow('Project deployed-bytecode budget headroom', formatNumber(expectedProjectBudget - bytecodeSnapshot.deployedBytes), formatNumber(expectedProjectBudget))
assertBudgetHeadroomRow('EIP-170 headroom', formatNumber(expectedEip170Budget - bytecodeSnapshot.deployedBytes), formatNumber(expectedEip170Budget))
assertZoltarForkDepths()

function assertZoltarForkDepths(): void {
	const initialSupply = 7_825_488_326_666_847_200_078_019n
	const oneRep = 10n ** 18n
	const protocolConfig = getMainnetProtocolConfig()
	let supply = initialSupply
	let escalationBoundary: number | undefined
	let subOneRepBoundary: number | undefined
	let zeroHaircutBoundary: number | undefined

	for (let depth = 0; zeroHaircutBoundary === undefined; depth += 1) {
		const threshold = supply / protocolConfig.forkThresholdDivisor
		const haircut = threshold / protocolConfig.forkBurnDivisor
		if (escalationBoundary === undefined && threshold / 2n <= oneRep) escalationBoundary = depth
		if (subOneRepBoundary === undefined && threshold < oneRep) subOneRepBoundary = depth
		if (haircut === 0n) {
			zeroHaircutBoundary = depth
			break
		}
		supply -= haircut
	}

	assert.equal(escalationBoundary, 1_213, 'Zoltar escalation boundary depth changed')
	assert.equal(subOneRepBoundary, 1_282, 'Zoltar sub-1-REP threshold depth changed')
	assert.equal(zeroHaircutBoundary, 5_303, 'Zoltar zero-haircut boundary depth changed')
	assert.equal(supply, 99n, 'Zoltar zero-haircut fixed-point supply changed')
	assert.equal(supply / protocolConfig.forkThresholdDivisor, 4n, 'Zoltar zero-haircut fixed-point threshold changed')
	const normalizedWhitepaper = zoltarWhitepaper.replaceAll(/\s+/g, ' ')
	for (const documentedClaim of [
		'at child depth <code>1,213</code>, the fork threshold is approximately <code>1.986 REP</code>',
		'at depth <code>1,282</code>, the fork threshold is below <code>1 REP</code>',
		'at depth <code>5,303</code>, theoretical supply is <code>99 wei</code>, the fork threshold is <code>4 wei</code>, and the haircut floors to zero',
	]) {
		assert.ok(normalizedWhitepaper.includes(documentedClaim), `Missing Zoltar fork-depth claim: ${documentedClaim}`)
	}
}

function assertSimpleByteRow(label: string, expectedValue: string): void {
	const escapedLabel = escapeRegExp(label)
	const match = html.match(new RegExp(`<td>${escapedLabel}</td>\\s*<td><code>([^<]+)</code> bytes</td>`))
	assert.ok(match, `Missing documentation row for ${label}`)
	assert.equal(match[1], expectedValue, `${label} should be ${expectedValue} in docs/escalation-game-architecture.html`)
}

function assertBudgetHeadroomRow(label: string, expectedHeadroom: string, expectedBudget: string): void {
	const escapedLabel = escapeRegExp(label)
	const match = html.match(new RegExp(`<td>${escapedLabel}</td>\\s*<td><code>([^<]+)</code> bytes below <code>([^<]+)</code></td>`))
	assert.ok(match, `Missing documentation row for ${label}`)
	assert.equal(match[1], expectedHeadroom, `${label} headroom should be ${expectedHeadroom} in docs/escalation-game-architecture.html`)
	assert.equal(match[2], expectedBudget, `${label} budget should be ${expectedBudget} in docs/escalation-game-architecture.html`)
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatNumber(value: number): string {
	return value.toLocaleString('en-US')
}

function readNumericConstant(source: string, constantName: string): number {
	const match = source.match(new RegExp(`const\\s+${constantName}\\s*=\\s*([\\d_]+)`))
	assert.ok(match, `Could not find ${constantName} in escalationGameInterfaceRegression.test.ts`)
	return Number(match[1]?.replaceAll('_', ''))
}

function readBytecodeSnapshot(source: string): { creationBytes: number; deployedBytes: number } {
	const parsed = JSON.parse(source) as unknown
	assert.ok(isRecord(parsed), 'Escalation game bytecode snapshot must be a JSON object')
	return {
		creationBytes: readNumberField(parsed, 'creationBytes'),
		deployedBytes: readNumberField(parsed, 'deployedBytes'),
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function readNumberField(record: Record<string, unknown>, fieldName: string): number {
	const value = Reflect.get(record, fieldName)
	if (typeof value !== 'number') {
		throw new Error(`Escalation game bytecode snapshot field ${fieldName} must be a number`)
	}
	return value
}
