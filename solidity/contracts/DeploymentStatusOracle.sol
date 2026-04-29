// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

contract DeploymentStatusOracle {
	address[] private deploymentAddresses;

	constructor(address[] memory _deploymentAddresses) {
		require(_deploymentAddresses.length <= uint256(type(uint8).max) + 1, 'deployment steps exceed mask capacity');
		deploymentAddresses = _deploymentAddresses;
	}

	function getDeploymentMask() external view returns (uint256 deployedMask) {
		for (uint256 index = 0; index < deploymentAddresses.length; ++index) {
			if (deploymentAddresses[index].code.length > 0) {
				deployedMask |= uint256(1) << index;
			}
		}
	}
}
