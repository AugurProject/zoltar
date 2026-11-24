// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { CreationCodeStorage } from '../../statoblast/CreationCodeStorage.sol';

contract CreationCodeStorageHarness {
	address public first;
	address public second;

	function store(bytes memory code) external {
		(first, second) = CreationCodeStorage.store(code);
	}

	function load() external view returns (bytes memory) {
		return CreationCodeStorage.load(first, second);
	}
}
