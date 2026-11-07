import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Window } from 'happy-dom'
import { concatHex, encodeAbiParameters, getAddress, keccak256 } from '../../shared/core/ts/evm/ethereum'

// Worked examples in the reference pages, recomputed from the contract rules they illustrate.

/** Recomputes the Merkle Mountain Range conformance vector from the contract's hashing rules. */
export async function checkMmrConformanceVector(): Promise<void> {
	const contractSource = await readFile('solidity/contracts/statoblast/MerkleMountainRange.sol', 'utf8')
	assert.match(contractSource, /keccak256\(abi\.encode\(depositor, outcome, amountAttoRep, parentDepositIndex, cumulativeAmountAttoRep, sourceNodeId\)\)/, 'MMR leaf hashing must match the documented ABI encoding')
	assert.match(contractSource, /keccak256\(abi\.encodePacked\(left, right\)\)/, 'MMR parent hashing must match the documented packed encoding')
	const window = new Window()
	try {
		window.document.write(await readFile('docs/reference/merkle-mountain-range.html', 'utf8'))
		window.document.close()
		const vector = new Map<string, string>()
		for (const row of window.document.querySelectorAll('#encoding tbody tr')) {
			const [label, value] = Array.from(row.querySelectorAll('td')).map(cell => cell.textContent.trim())
			if (label !== undefined && value !== undefined) vector.set(label, value)
		}
		const vectorValue = (label: string): string => {
			const value = vector.get(label)
			if (value === undefined) throw new Error(`MMR conformance vector is missing ${label}`)
			return value
		}
		const leafHash = (label: string) => {
			const [depositor, ...integers] = vectorValue(label)
				.split(',')
				.map(value => value.trim())
			if (depositor === undefined || integers.length !== 5) throw new Error(`${label} must list six ABI values`)
			return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [getAddress(depositor), ...integers.map(value => BigInt(value))]))
		}
		const leaf0 = leafHash('Leaf 0 ABI values')
		const leaf1 = leafHash('Leaf 1 ABI values')
		assert.equal(vectorValue('Leaf 0 hash'), leaf0, 'MMR conformance vector leaf 0 hash must match keccak256(abi.encode(...))')
		assert.equal(vectorValue('Leaf 1 hash'), leaf1, 'MMR conformance vector leaf 1 hash must match keccak256(abi.encode(...))')
		const leaf2 = leafHash('Leaf 2 ABI values')
		const twoLeafRoot = keccak256(concatHex([leaf0, leaf1]))
		assert.equal(vectorValue('Leaf 2 hash'), leaf2, 'MMR conformance vector leaf 2 hash must match keccak256(abi.encode(...))')
		assert.equal(vectorValue('Two-leaf root'), twoLeafRoot, 'MMR conformance vector root must hash leaf 0 before leaf 1 with abi.encodePacked')
		assert.equal(vectorValue('Three-leaf root'), keccak256(concatHex([leaf2, twoLeafRoot])), 'MMR conformance vector must bag the lower peak as the left operand')
		let emptyNullifierRoot: `0x${string}` = `0x${'00'.repeat(32)}`
		for (let level = 0; level < 64; level += 1) emptyNullifierRoot = keccak256(concatHex([emptyNullifierRoot, emptyNullifierRoot]))
		assert.equal(vectorValue('Empty nullifier root'), emptyNullifierRoot, 'MMR conformance vector empty nullifier root must hash the zero leaf with itself 64 times')
	} finally {
		window.close()
	}
}
