//require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-verify");
const path = require("path");

const PRIVATE_KEY ="63cdccc9866523d947216aac758200d1bf09e90d82975c2f44007ed319073d00";

module.exports = {
  solidity: {
    version: "0.8.23", // Specify compiler version
    settings: {
      optimizer: {
          enabled: true,
          runs: 200
      }
  }
  },
  etherscan: {
    apiKey: {
      blast_sepolia: "blast_sepolia", // apiKey is not required, just set a placeholder
    },
    customChains: [
      {
        network: "blast_sepolia",
        chainId: 168587773,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/testnet/evm/168587773/etherscan",
          browserURL: "https://testnet.blastscan.io"
        }
      }
    ]
  },
  networks: {
    blast_sepolia: {
      url: 'https://sepolia.blast.io',
      accounts: [PRIVATE_KEY]
    },
  },
  // Add other Hardhat configurations if necessary
};


