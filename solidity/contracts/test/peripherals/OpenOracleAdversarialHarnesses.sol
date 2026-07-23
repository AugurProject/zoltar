// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../../IERC20.sol';
import { IERC1155Receiver } from '../../peripherals/interfaces/IERC1155Receiver.sol';

interface IOpenOracleAdversarialTarget {
	function getETHProtocolFees() external returns (uint256);
}

contract OpenOracleTestToken is IERC20 {
	string public name;
	string public symbol;
	uint8 public constant decimals = 18;
	uint256 public totalSupply;
	bool public failTransfer;
	bool public failTransferFrom;

	mapping(address => uint256) public balanceOf;
	mapping(address => mapping(address => uint256)) public allowance;

	constructor(string memory tokenName, string memory tokenSymbol) {
		name = tokenName;
		symbol = tokenSymbol;
	}

	function mint(address recipient, uint256 amount) external {
		totalSupply += amount;
		balanceOf[recipient] += amount;
		emit Transfer(address(0), recipient, amount);
	}

	function setTransferFailures(bool shouldFailTransfer, bool shouldFailTransferFrom) external {
		failTransfer = shouldFailTransfer;
		failTransferFrom = shouldFailTransferFrom;
	}

	function approve(address spender, uint256 amount) external returns (bool) {
		allowance[msg.sender][spender] = amount;
		emit Approval(msg.sender, spender, amount);
		return true;
	}

	function transfer(address recipient, uint256 amount) external returns (bool) {
		if (failTransfer) return false;
		_transfer(msg.sender, recipient, amount);
		return true;
	}

	function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
		if (failTransferFrom) return false;
		uint256 currentAllowance = allowance[sender][msg.sender];
		require(currentAllowance >= amount, 'OpenOracle test token allowance too low');
		if (currentAllowance != type(uint256).max) {
			allowance[sender][msg.sender] = currentAllowance - amount;
			emit Approval(sender, msg.sender, allowance[sender][msg.sender]);
		}
		_transfer(sender, recipient, amount);
		return true;
	}

	function _transfer(address sender, address recipient, uint256 amount) internal {
		require(recipient != address(0), 'OpenOracle test token recipient is zero');
		uint256 senderBalance = balanceOf[sender];
		require(senderBalance >= amount, 'OpenOracle test token balance too low');
		balanceOf[sender] = senderBalance - amount;
		balanceOf[recipient] += amount;
		emit Transfer(sender, recipient, amount);
	}
}

// Intentionally omits return values to model legacy ERC-20 implementations.
// OpenOracle's low-level transfer helpers accept this shape when the call succeeds.
contract OpenOracleNoReturnToken {
	string public name;
	string public symbol;
	uint8 public constant decimals = 18;
	uint256 public totalSupply;

	mapping(address => uint256) public balanceOf;
	mapping(address => mapping(address => uint256)) public allowance;

	constructor(string memory tokenName, string memory tokenSymbol) {
		name = tokenName;
		symbol = tokenSymbol;
	}

	function mint(address recipient, uint256 amount) external {
		totalSupply += amount;
		balanceOf[recipient] += amount;
	}

	function approve(address spender, uint256 amount) external {
		allowance[msg.sender][spender] = amount;
	}

	function transfer(address recipient, uint256 amount) external {
		_transfer(msg.sender, recipient, amount);
	}

	function transferFrom(address sender, address recipient, uint256 amount) external {
		uint256 currentAllowance = allowance[sender][msg.sender];
		require(currentAllowance >= amount, 'OpenOracle no-return allowance too low');
		if (currentAllowance != type(uint256).max) allowance[sender][msg.sender] = currentAllowance - amount;
		_transfer(sender, recipient, amount);
	}

	function _transfer(address sender, address recipient, uint256 amount) internal {
		require(recipient != address(0), 'OpenOracle no-return recipient is zero');
		uint256 senderBalance = balanceOf[sender];
		require(senderBalance >= amount, 'OpenOracle no-return balance too low');
		balanceOf[sender] = senderBalance - amount;
		balanceOf[recipient] += amount;
	}
}

contract OpenOracleRejectingETHReceiver is IERC1155Receiver {
	bool public rejectETH = true;

	function setRejectETH(bool shouldReject) external {
		rejectETH = shouldReject;
	}

	function execute(address target, bytes calldata data) external payable returns (bytes memory result) {
		(bool success, bytes memory returnData) = target.call{ value: msg.value }(data);
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

	function onERC1155BatchReceived(
		address,
		address,
		uint256[] calldata,
		uint256[] calldata,
		bytes calldata
	) external pure returns (bytes4) {
		return IERC1155Receiver.onERC1155BatchReceived.selector;
	}

	receive() external payable {
		require(!rejectETH, 'OpenOracle test receiver rejects ETH');
	}
}

contract OpenOracleReentrantCallback {
	address public immutable oracle;
	bool public attempted;
	bool public reentrantCallSucceeded;

	constructor(address oracleAddress) {
		oracle = oracleAddress;
	}

	function openOracleCallback(uint256 reportId, uint256, uint256, uint256, address, address) external {
		require(msg.sender == oracle, 'OpenOracle callback caller is not oracle');
		attempted = true;
		(reentrantCallSucceeded, ) = oracle.call(abi.encodeWithSignature('settle(uint256)', reportId));
	}
}
