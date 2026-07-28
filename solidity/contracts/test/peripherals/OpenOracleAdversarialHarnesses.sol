// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../../IERC20.sol';
import { IERC1155Receiver } from '../../peripherals/interfaces/IERC1155Receiver.sol';
import { IOpenOracleDispute, IUniswapV3SwapRouter } from '../../peripherals/OpenOracleArbitrageExecutor.sol';
import { SafeERC20Ops } from '../../SafeERC20Ops.sol';

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

	function _transfer(address sender, address recipient, uint256 amount) internal virtual {
		require(recipient != address(0), 'OpenOracle test token recipient is zero');
		uint256 senderBalance = balanceOf[sender];
		require(senderBalance >= amount, 'OpenOracle test token balance too low');
		balanceOf[sender] = senderBalance - amount;
		balanceOf[recipient] += amount;
		emit Transfer(sender, recipient, amount);
	}
}

contract OpenOracleFeeToken is OpenOracleTestToken {
	uint256 private constant BPS = 10_000;
	uint256 public immutable feeBps;

	constructor(uint256 transferFeeBps) OpenOracleTestToken('Fee Token', 'FEE') {
		require(transferFeeBps < BPS, 'OpenOracle fee token fee too high');
		feeBps = transferFeeBps;
	}

	function _transfer(address sender, address recipient, uint256 amount) internal override {
		require(recipient != address(0), 'OpenOracle fee token recipient is zero');
		uint256 senderBalance = balanceOf[sender];
		require(senderBalance >= amount, 'OpenOracle fee token balance too low');
		uint256 fee = (amount * feeBps) / BPS;
		balanceOf[sender] = senderBalance - amount;
		balanceOf[recipient] += amount - fee;
		totalSupply -= fee;
		emit Transfer(sender, recipient, amount - fee);
		emit Transfer(sender, address(0), fee);
	}
}

contract OpenOracleArbitrageExecutorTarget {
	using SafeERC20Ops for IERC20;

	mapping(address => mapping(address => uint256)) public tokenHolder;
	mapping(address => mapping(address => mapping(address => uint256))) public internalAllowance;
	uint256 public settleCalls;

	function dispute(
		uint256,
		uint128,
		uint128,
		address,
		bool,
		bool,
		IOpenOracleDispute.OracleGame calldata params,
		IOpenOracleDispute.PreimageHelper calldata,
		IOpenOracleDispute.TimingBoundaries calldata
	) external payable {
		IERC20 token1 = IERC20(params.token1);
		IERC20 token2 = IERC20(params.token2);
		uint256 allowance1 = token1.allowance(msg.sender, address(this));
		uint256 allowance2 = token2.allowance(msg.sender, address(this));
		if (allowance1 != 0) token1.safeTransferFrom(msg.sender, address(this), allowance1);
		if (allowance2 != 0) token2.safeTransferFrom(msg.sender, address(this), allowance2);
	}

	function credit(address token, uint256 amount, address beneficiary) external {
		IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
		tokenHolder[beneficiary][token] += amount;
	}

	function approveInternal(address spender, address token, uint256 amount) external {
		internalAllowance[msg.sender][spender][token] = amount;
	}

	function internalTransferFrom(address from, address to, address token, uint128 amount) external {
		uint256 allowance = internalAllowance[from][msg.sender][token];
		require(allowance >= amount, 'OpenOracle target internal allowance too low');
		if (allowance != type(uint256).max) internalAllowance[from][msg.sender][token] = allowance - amount;
		require(tokenHolder[from][token] >= amount, 'OpenOracle target internal balance too low');
		tokenHolder[from][token] -= amount;
		tokenHolder[to][token] += amount;
	}

	function withdrawTo(address token, uint256 amount, address to) external returns (uint256 sent) {
		uint256 balance = tokenHolder[msg.sender][token];
		sent = amount > balance ? balance : amount;
		tokenHolder[msg.sender][token] = balance - sent;
		IERC20(token).safeTransfer(to, sent);
	}

	function settle(
		uint256,
		IOpenOracleDispute.OracleGame calldata params,
		IOpenOracleDispute.PreimageHelper calldata
	) external {
		settleCalls += 1;
		tokenHolder[params.currentReporter][params.token1] += params.currentAmount1;
		tokenHolder[params.currentReporter][params.token2] += params.currentAmount2;
	}
}

contract OpenOracleSwapRouterTarget is IUniswapV3SwapRouter {
	using SafeERC20Ops for IERC20;

	function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
		require(block.timestamp <= params.deadline, 'OpenOracle test swap deadline expired');
		amountOut = params.amountIn;
		require(amountOut >= params.amountOutMinimum, 'OpenOracle test swap output too low');
		IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
		IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
	}

	function exactOutputSingle(ExactOutputSingleParams calldata params) external payable returns (uint256 amountIn) {
		require(block.timestamp <= params.deadline, 'OpenOracle test swap deadline expired');
		amountIn = params.amountOut;
		require(amountIn <= params.amountInMaximum, 'OpenOracle test swap input too high');
		IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
		IERC20(params.tokenOut).safeTransfer(params.recipient, params.amountOut);
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
