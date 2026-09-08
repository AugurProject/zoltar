import { execFileSync } from 'node:child_process'
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
	test('preserves CLI ignore behavior for check and write', async () => {
		const directory = await mkdtemp(join(import.meta.dir, '../../solidity/contracts/statoblast/openOracle/openzeppelin/formatter-test-'))
		const file = join(directory, 'Ignored.sol')
		const source = 'contract Example { uint256 value=1; }'
		try {
			await writeFile(file, source)
			const expected = execFileSync('bunx', ['prettier', '--config', join(import.meta.dir, '../../.prettierrc.json'), '--stdin-filepath', file], { input: source, encoding: 'utf8' })
			expect(expected).toBe(source)
			expect(await checkSolidityFiles([file])).toEqual([])
			expect(await writeSolidityFiles([file])).toEqual([])
			expect(await readFile(file, 'utf8')).toBe(source)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
	test('batch formatting preserves CLI output, is idempotent, and does not write on check', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-solidity-batch-'))
		try {
			const files = [join(directory, 'First.sol'), join(directory, 'Second.sol')]
			const source = 'contract Example { function update(uint256 x, address y) external { emit Changed(x,y); } event Changed(uint256 x,address y); }'
			for (const file of files) await writeFile(file, source)
			const expected = files.map(file => enforceSolidityOneLineForms(execFileSync('bunx', ['prettier', '--config', join(import.meta.dir, '../../.prettierrc.json'), '--stdin-filepath', file], { input: source, encoding: 'utf8' })))
			expect(await checkSolidityFiles(files)).toHaveLength(2)
			for (const file of files) expect(await readFile(file, 'utf8')).toBe(source)
			expect(await writeSolidityFiles(files)).toHaveLength(2)
			expect(await Promise.all(files.map(file => readFile(file, 'utf8')))).toEqual(expected)
			expect(await writeSolidityFiles(files)).toEqual([])
			expect(await checkSolidityFiles(files)).toEqual([])
			expect(await checkSolidityFiles([])).toEqual([])
			expect(await writeSolidityFiles([])).toEqual([])
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
})
