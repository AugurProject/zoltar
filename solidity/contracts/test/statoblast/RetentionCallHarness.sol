// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { EscalationGameStorage } from '../../statoblast/EscalationGameStorage.sol';
contract RetentionCallHarness is EscalationGameStorage {
	uint256 public mode;
	function setMode(uint256 value) external {
		mode = value;
	}
	function evaluate() external view returns (uint256, uint256, uint256, uint256) {
		return _getInheritedClaimAllocation(1, 1, 2, 0);
	}
	fallback() external {
		if (mode == 0) revert('Retention unavailable');
		if (mode == 1) {
			assembly {
				return(0, 0)
			}
		}
		assembly {
			mstore(0, 42)
			mstore(32, 21)
			mstore(64, 63)
			mstore(96, 84)
			return(0, 128)
		}
	}
}
