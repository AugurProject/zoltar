// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC1155Receiver } from '../../statoblast/interfaces/IERC1155Receiver.sol';

interface IOpenOracleAdversarialTarget {
	function getETHProtocolFees() external returns (uint256);
}

contract OpenOracleRejectingETHReceiver is IERC1155Receiver {
	bool public rejectETH = true;
	bool public consumeAllGas;
	bool public reenterOnReceive;
	address public receiveReentryTarget;
	bytes public receiveReentryData;

	function setRejectETH(bool shouldReject) external {
		rejectETH = shouldReject;
	}

	function setConsumeAllGas(bool shouldConsume) external {
		consumeAllGas = shouldConsume;
	}

	function setReceiveReentry(address target, bytes calldata data) external {
		receiveReentryTarget = target;
		receiveReentryData = data;
		reenterOnReceive = true;
	}

	function execute(address target, bytes calldata data) external payable returns (bytes memory result) {
		(bool success, bytes memory returnData) = target.call{value: msg.value}(data);
		if (!success) {
			assembly {
				revert(add(returnData, 32), mload(returnData))
			}
		}
		return returnData;
	}

	function claim(address oracle) external returns (uint256) {
		return IOpenOracleAdversarialTarget(oracle).getETHProtocolFees();
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == type(IERC1155Receiver).interfaceId;
	}

	function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
		return IERC1155Receiver.onERC1155Received.selector;
	}

	function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
		return IERC1155Receiver.onERC1155BatchReceived.selector;
	}

	receive() external payable {
		if (reenterOnReceive) {
			reenterOnReceive = false;
			(bool success, bytes memory returnData) = receiveReentryTarget.call(receiveReentryData);
			if (!success) {
				assembly {
					revert(add(returnData, 32), mload(returnData))
				}
			}
			return;
		}
		if (consumeAllGas) {
			assembly {
				invalid()
			}
		}
		require(!rejectETH, 'OpenOracle test receiver rejects ETH');
	}
}
