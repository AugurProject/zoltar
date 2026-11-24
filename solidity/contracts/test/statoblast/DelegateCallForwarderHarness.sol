// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { DelegateErrorReason } from '../../statoblast/DelegateErrorReason.sol';
import { DelegateCallForwarder } from '../../statoblast/DelegateCallForwarder.sol';

contract DelegateCallForwarderHarness {
	function decodeError(bytes memory result) external pure returns (string memory) {
		return DelegateErrorReason.decode(result);
	}

	function forwardFailure(bytes calldata result) external {
		DelegateCallForwarder.invokeWithDecodedRevert(address(this), abi.encodeCall(this.fail, (result)));
	}

	function fail(bytes memory result) external pure {
		assembly ('memory-safe') {
			revert(add(result, 32), mload(result))
		}
	}

	function forwardSuccess(uint256 value) external returns (uint256) {
		return
			abi.decode(DelegateCallForwarder.invokeWithDecodedRevert(address(this), abi.encodeCall(this.succeed, (value))), (uint256));
	}

	function succeed(uint256 value) external pure returns (uint256) {
		return value;
	}
}
