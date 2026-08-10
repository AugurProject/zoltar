import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkSolidityFiles, enforceSolidityOneLineForms, writeSolidityFiles } from './format-solidity-one-line.mts'

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

	test('check detects Prettier differences outside one-line ranges and write fixes them', async () => {
		const temporaryDirectory = await mkdtemp(join(tmpdir(), 'zoltar-solidity-format-'))
		const filePath = join(temporaryDirectory, 'Example.sol')
		try {
			await writeFile(
				filePath,
				`contract Example {
function untouched() external {
uint256 value=1;
}
}
`,
			)
			expect(await checkSolidityFiles([filePath])).toHaveLength(1)
			expect(await writeSolidityFiles([filePath])).toHaveLength(1)
			expect(await readFile(filePath, 'utf8')).toContain('uint256 value = 1;')
			expect(await checkSolidityFiles([filePath])).toEqual([])
		} finally {
			await rm(temporaryDirectory, { force: true, recursive: true })
		}
	})
})
