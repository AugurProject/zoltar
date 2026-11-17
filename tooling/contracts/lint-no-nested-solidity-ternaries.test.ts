import { expect, test } from 'bun:test'
import { scanSolidityFile } from './lint-no-nested-solidity-ternaries.mts'

const file = 'solidity/contracts/Example.sol'
const positions = (source: string) => scanSolidityFile(file, source).map(finding => [finding.line, finding.column, finding.parentLine, finding.parentColumn])

test('a single conditional expression is accepted', () => {
	expect(positions('function pick(bool a) pure returns (uint256) { return a ? 1 : 2; }')).toEqual([])
})

test('a conditional nested in either branch is reported with its parent', () => {
	expect(positions('uint256 x = a ? (b ? 1 : 2) : 3;')).toEqual([[1, 20, 1, 15]])
	expect(positions('uint256 x = a ? 1 : b ? 2 : 3;')).toEqual([[1, 23, 1, 15]])
	expect(positions(['uint256 x = a', '\t? 1', '\t: b', '\t\t? 2', '\t\t: 3;'].join('\n'))).toEqual([[4, 3, 2, 2]])
})

test('sequential conditionals in separate statements or arguments are not nested', () => {
	expect(positions('uint256 x = a ? 1 : 2; uint256 y = b ? 3 : 4;')).toEqual([])
	expect(positions('f(a ? 1 : 2, b ? 3 : 4);')).toEqual([])
})

test('question marks inside comments and strings are ignored', () => {
	const source = ['// why ? because : reasons ? yes : no', '/* a ? b ? c : d : e */', 'string constant QUESTION = "a ? b ? c : d : e";', 'uint256 x = a ? 1 : 2;'].join('\n')
	expect(positions(source)).toEqual([])
})
