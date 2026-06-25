// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

contract DeploymentStatusOracle {
	address[] private deploymentAddresses;

	event DeploymentAddressesSet(address[] deploymentAddresses);

	constructor(address[] memory _deploymentAddresses) {
		require(
			_deploymentAddresses.length <= uint256(type(uint8).max) + 1,
			'DeploymentStatusOracle supports at most 256 deployment steps'
		);
		deploymentAddresses = _deploymentAddresses;
		emit DeploymentAddressesSet(_deploymentAddresses);
	}

	function getDeploymentMask() external view returns (uint256 deployedMask) {
		for (uint256 index = 0; index < deploymentAddresses.length; ++index) {
			if (deploymentAddresses[index].code.length > 0) {
				deployedMask |= uint256(1) << index;
			}
		}
	}
}
