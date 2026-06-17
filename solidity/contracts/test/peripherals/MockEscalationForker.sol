// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from '../../peripherals/interfaces/ISecurityPool.sol';
import { BinaryOutcomes } from '../../peripherals/BinaryOutcomes.sol';
import { Math } from '../../peripherals/openOracle/openzeppelin/contracts/utils/math/Math.sol';

contract MockEscalationForker {
	struct ForkedEscrow {
		uint256 principal;
		uint256 childRep;
		uint256 principalClaimed;
		uint256 childRepClaimed;
	}

	mapping(ISecurityPool => mapping(address => mapping(uint8 => ForkedEscrow))) private escrowByPoolVaultOutcome;

	function setForkedEscrow(
		ISecurityPool securityPool,
		address vault,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 principal,
		uint256 childRep
	) external {
		escrowByPoolVaultOutcome[securityPool][vault][uint8(outcome)] = ForkedEscrow({
			principal: principal,
			childRep: childRep,
			principalClaimed: 0,
			childRepClaimed: 0
		});
	}

	function consumeForkedEscrow(
		ISecurityPool securityPool,
		address vault,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 principalAmount
	) external returns (uint256 forkedEscrowPrincipal, uint256 forkedEscrowChildRep, uint256 childRepToRelease) {
		ForkedEscrow storage escrow = escrowByPoolVaultOutcome[securityPool][vault][uint8(outcome)];
		forkedEscrowPrincipal = escrow.principal;
		if (forkedEscrowPrincipal == 0 || principalAmount == 0) return (0, 0, 0);
		require(escrow.principalClaimed + principalAmount <= escrow.principal, 'fork escrow exhausted');
		forkedEscrowChildRep = escrow.childRep;
		uint256 nextPrincipalClaimed = escrow.principalClaimed + principalAmount;
		uint256 nextChildRepClaimed = Math.ceilDiv(nextPrincipalClaimed * forkedEscrowChildRep, escrow.principal);
		childRepToRelease = nextChildRepClaimed - escrow.childRepClaimed;
		escrow.principalClaimed = nextPrincipalClaimed;
		escrow.childRepClaimed = nextChildRepClaimed;
	}
}
