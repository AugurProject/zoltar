// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { EscalationGameStorage } from '../../statoblast/EscalationGameStorage.sol';
contract RetentionCallHarness is EscalationGameStorage {
	uint256 public mode;
	function setMode(uint256 value) external {
		mode = value;
	}
	function evaluate(bool storageBasis) external view returns (uint256) {
		if (storageBasis) return _applyInheritedSourceStorageBasis(1, 2, 3);
		return _applyInheritedSourceRetention(1, 3);
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
			return(0, 32)
		}
	}
}
