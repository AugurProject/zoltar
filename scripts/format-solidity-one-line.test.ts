import { describe, expect, test } from 'bun:test'
import { enforceSolidityOneLineForms } from './format-solidity-one-line.mts'

describe('Solidity one-line formatter', () => {
	test('collapses events, function parameters, emits, and nested calls', () => {
		const source = `contract Example {
	event Changed(
		uint256 value,
		address account
	);

	function update(
		uint256 value,
		address account
	) external {
		emit Changed(
			value,
			account
		);
		store(
			value,
			convert(
				account
			)
		);
	}
}`

		expect(enforceSolidityOneLineForms(source)).toBe(`contract Example {
	event Changed(uint256 value, address account);

	function update(uint256 value, address account) external {
		emit Changed(value, account);
		store(value, convert(account));
	}
}`)
	})

	test('converts line comments inside a collapsed argument list without commenting out code', () => {
		const source = `contract Example {
	function update(
		uint256 value, // exact amount
		address account
	) external {}
}`

		expect(enforceSolidityOneLineForms(source)).toContain('function update(uint256 value, /* exact amount */ address account) external {}')
	})
})
