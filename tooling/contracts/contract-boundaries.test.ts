import { expect, test } from 'bun:test'
import { findContractBoundaryViolations } from './contract-boundaries.js'

test('rejects production dependencies on test contracts', () => {
	const findings = findContractBoundaryViolations('solidity/contracts/Zoltar.sol', "import './test/ZoltarHarness.sol';")
	expect(findings.map(finding => finding.reason)).toEqual(['production contracts must not import test contracts'])
})

test('keeps Statoblast core independent from optional Trading', () => {
	const findings = findContractBoundaryViolations('solidity/contracts/statoblast/SecurityPool.sol', "import '../trading/TwoWayConstantProductPair.sol';")
	expect(findings.map(finding => finding.reason)).toEqual(['Statoblast core must not depend on optional Trading contracts'])
})

test('allows Trading to consume the explicit Statoblast interface surface', () => {
	const sourcePath = 'solidity/contracts/trading/Router.sol'
	expect(findContractBoundaryViolations(sourcePath, "import '../statoblast/interfaces/ISecurityPool.sol';")).toEqual([])
	expect(findContractBoundaryViolations(sourcePath, "import '../statoblast/BinaryOutcomes.sol';")).toEqual([])
	expect(findContractBoundaryViolations(sourcePath, "import '../statoblast/SecurityPool.sol';")).toHaveLength(1)
})

test('keeps the vendored OpenOracle tree self-contained', () => {
	const sourcePath = 'solidity/contracts/statoblast/openOracle/OpenOracle.sol'
	expect(findContractBoundaryViolations(sourcePath, "import './interfaces/ISignatureTransfer.sol';")).toEqual([])
	expect(findContractBoundaryViolations(sourcePath, "import '../../Zoltar.sol';")).toHaveLength(1)
})
