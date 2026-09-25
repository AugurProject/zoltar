// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Arithmetic for explicitly assigned coverage, independent of REP ownership and share supply.
library CoverageObligationMath {
	function obligation(uint256 collateralAttoEth, uint256 units, uint256 totalUnits) internal pure returns (uint256) {
		require(units <= totalUnits, 'Obligation units exceed total');
		if (units == 0) return 0;
		return Math.mulDiv(collateralAttoEth, units, totalUnits, Math.Rounding.Ceil);
	}

	/// @dev The caller must start an epoch only after all old economic share claims are exhausted.
	function mintUnits(uint256 collateralAttoEth, uint256 totalUnits, uint256 addedCollateralAttoEth) internal pure returns (uint256) {
		require(addedCollateralAttoEth > 0, 'Zero mint collateral');
		if (totalUnits == 0) {
			require(collateralAttoEth == 0, 'Unassigned collateral');
			return addedCollateralAttoEth;
		}
		require(collateralAttoEth > 0, 'Exhausted collateral epoch');
		return Math.mulDiv(addedCollateralAttoEth, totalUnits, collateralAttoEth, Math.Rounding.Ceil);
	}

	/// @notice Only the actively secured fraction is charged fees. Written-off and unbacked units remain in the denominator.
	function feeBase(uint256 collateralAttoEth, uint256 activeUnits, uint256 totalUnits) internal pure returns (uint256) {
		require(activeUnits <= totalUnits, 'Active units exceed total');
		if (activeUnits == 0) return 0;
		return Math.mulDiv(collateralAttoEth, activeUnits, totalUnits);
	}
}
