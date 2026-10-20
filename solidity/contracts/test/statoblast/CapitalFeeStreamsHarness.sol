// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolCapitalFeeStreams } from '../../statoblast/SecurityPoolCapitalFeeStreams.sol';

contract CapitalFeeStreamsHarness {
	SecurityPoolCapitalFeeStreams public immutable streams;
	uint256 public releasedEth;
	uint256 public releasedRep;
	constructor() {
		streams = new SecurityPoolCapitalFeeStreams(address(this), uint48(block.timestamp));
	}
	function add(uint256 ethAmount, uint256 repAmount, uint48 duration) external {
		_release(uint48(block.timestamp));
		streams.addStream(ethAmount, repAmount, duration);
	}
	function addWithoutCheckpoint(uint256 ethAmount, uint256 repAmount, uint48 duration) external {
		streams.addStream(ethAmount, repAmount, duration);
	}
	function release(uint48 timestamp) external {
		_release(timestamp);
	}
	function _release(uint48 timestamp) private {
		(uint256 ethAmount, uint256 repAmount) = streams.release(timestamp);
		releasedEth += ethAmount;
		releasedRep += repAmount;
	}
}
