// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { CoverageObligationMath } from '../../statoblast/CoverageObligationMath.sol';

contract CoverageObligationMathHarness {
	function obligation(uint256 collateralAttoEth, uint256 units, uint256 totalUnits) external pure returns (uint256) {
		return CoverageObligationMath.obligation(collateralAttoEth, units, totalUnits);
	}

	function mintUnits(uint256 collateralAttoEth, uint256 totalUnits, uint256 addedCollateralAttoEth) external pure returns (uint256) {
		return CoverageObligationMath.mintUnits(collateralAttoEth, totalUnits, addedCollateralAttoEth);
	}

	function feeBase(uint256 collateralAttoEth, uint256 activeUnits, uint256 totalUnits) external pure returns (uint256) {
		return CoverageObligationMath.feeBase(collateralAttoEth, activeUnits, totalUnits);
	}

	function checkNonparticipatingSequence(uint256 collateral, uint256 totalUnits, uint256 vaultUnits, uint256[] calldata additions, uint256[] calldata reductions) external pure {
		require(additions.length == reductions.length, 'Sequence length');
		uint256 previous = CoverageObligationMath.obligation(collateral, vaultUnits, totalUnits);
		for (uint256 i; i < additions.length; i++) {
			totalUnits += CoverageObligationMath.mintUnits(collateral, totalUnits, additions[i]);
			collateral += additions[i];
			uint256 afterMint = CoverageObligationMath.obligation(collateral, vaultUnits, totalUnits);
			require(afterMint <= previous, 'Mint increased nonparticipant obligation');
			collateral -= reductions[i];
			previous = CoverageObligationMath.obligation(collateral, vaultUnits, totalUnits);
			require(previous <= afterMint, 'Reduction increased obligation');
		}
	}
}
