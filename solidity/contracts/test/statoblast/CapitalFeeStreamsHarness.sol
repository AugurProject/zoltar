// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolCapitalFeeStreams } from '../../statoblast/SecurityPoolCapitalFeeStreams.sol';

contract CapitalFeeStreamsHarness {
	SecurityPoolCapitalFeeStreams public immutable streams;
	uint256 public releasedEth;
	uint256 public releasedRep;
	constructor(uint48 vestingDuration) {
		streams = new SecurityPoolCapitalFeeStreams(address(this), uint48(block.timestamp), vestingDuration);
	}
	function add(uint256 ethAmount, uint256 repAmount) external {
		_release(uint48(block.timestamp));
		streams.addStream(ethAmount, repAmount);
	}
	function addWithoutCheckpoint(uint256 ethAmount, uint256 repAmount) external {
		streams.addStream(ethAmount, repAmount);
	}
	function addTwice(uint256 firstEth, uint256 firstRep, uint256 secondEth, uint256 secondRep) external {
		_release(uint48(block.timestamp));
		streams.addStream(firstEth, firstRep);
		streams.addStream(secondEth, secondRep);
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
