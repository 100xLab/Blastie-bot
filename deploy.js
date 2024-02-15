require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { ethers } = require('ethers');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const algorithm = 'aes-256-ctr';
const { getContractSource } = require('./standard');
const { getCustomContractSource } = require('./custom');
const { get404ContractSource } = require('./ERC404');
const solc = require('solc');
const hre = require("hardhat");
const fetch = require('node-fetch');

const fs = require('fs');
const path = require('path');
const os = require('os');
const FormData = require('form-data');
const { exec, execSync } = require('child_process');
const { rimraf } = require('rimraf');


const redis = require('redis');
const { Console } = require('console');

const redisClient = redis.createClient({
    host: "127.0.0.1", // Fallback to localhost if the variable is not set
    port: 6379
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

redisClient.on('connect', () => console.log('Connected to Redis'));

console.log(`Connecting to Redis at host: ${redisClient.options.host}, port: ${redisClient.options.port}`);




// Load environment variables
const mongoUrl = process.env.MONGO_DB_URL;
const dbName = process.env.DB_NAME;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const secretKey = process.env.ENCRYPTION_KEY; 


async function initializeUserSession(userId) {
    try {
        // Check if user session already exists in Redis

        if (!redisClient.isOpen) {
            throw new Error('Redis client is not connected');
        }

        const sessionExists = await redisClient.exists(`session:${userId}`);

        if (!sessionExists) {
            // Define initial user session structure
            const userSession = {
                chain: "Not set",
                deployerAddress: "",
                name: "Not set",
                symbol: "Not set",
                supply: "Not set",
                baseuri: "Not set",
                buyTax: {
                    reflection: "Not set",
                    liquidity: "Not set",
                    marketing: "Not set",
                    burn: "Not set"
                },
                sellTax: {
                    reflection: "Not set",
                    liquidity: "Not set",
                    marketing: "Not set",
                    burn: "Not set"
                },
                txnLimit: {
                    MaxBuyTxnAmount: "Not set",
                    MaxSellTxnAmount: "Not set",
                    MaxWalletAmount: "Not set",

                },
               
                MarketingWallet: "Not set",
                website: "Not set",
                telegram: "Not set",
                twitter: "Not set",
                description: "Not set",
                gwei: "latest gwei price", // Placeholder, replace with actual logic
                deployCost: "estimate deploy cost", // Placeholder, replace with actual logic
                serviceFee: "0.05 ETH",
                total: "Calculate total fee", // Placeholder, replace with actual logic
                currentState: null
            };

            // Save the new user session in Redis
            await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
            console.log("New user session created in Redis for userId:", userId);
        } else {
            console.log("User session already exists in Redis for userId:", userId);
        }
    } catch (err) {
        console.error("Error initializing user session:", err);
    }
}

// Initialize MongoDB Client
const client = new MongoClient(mongoUrl);
const db = client.db(dbName);

// Connect to MongoDB
async function connectMongoDB() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
    } catch (e) {
        console.error('Failed to connect to MongoDB', e);
    }
}

// Initialize the Bot with the Telegram Token
const bot = new TelegramBot(telegramBotToken, { polling: true });

// Connect to the Blast Testnet
const provider = new ethers.providers.JsonRpcProvider(`https://rpc.ankr.com/blast_testnet_sepolia/${process.env.ANKRKEY}`);

const encrypt = (text) => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(secretKey, 'hex'), iv);
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
    return { iv: iv.toString('hex'), content: encrypted.toString('hex') };
};

const decryptPrivateKey = (encryptedData) => {
    const decipher = crypto.createDecipheriv(algorithm, Buffer.from(secretKey, 'hex'), Buffer.from(encryptedData.iv, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedData.content, 'hex')), decipher.final()]);
    return decrypted.toString();
};

function generateHexKey() {
    return crypto.randomBytes(32).toString('hex');
}


// '/start' Command Handler



async function getCurrentGasPriceAndBlock(provider) {
    const gasPrice = await provider.getGasPrice();
    const blockNumber = await provider.getBlockNumber();

    return {
        gasPrice: ethers.utils.formatUnits(gasPrice, 'gwei'),
        blockNumber
    };
}


////////////// User verification for group ///////////




async function getCurrentEthPrice() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        const data = await response.json();
        return data.ethereum.usd; // Assuming the response has the structure { ethereum: { usd: <price> } }
    } catch (error) {
        console.error('Failed to fetch ETH price:', error);
        return null;
    }
}


// Function to Show Main Menu
async function showMainMenu(chatId, user, userSession = null) {




    const balance = await provider.getBalance(user.walletAddress);
    const ethBalance = ethers.utils.formatEther(balance);

    const { gasPrice, blockNumber } = await getCurrentGasPriceAndBlock(provider);
    const ethPrice = await getCurrentEthPrice();
    const formattedGasPrice = parseFloat(gasPrice).toFixed(4);

    const walletAddressLink = `https://testnet.blastscan.io/address/${user.walletAddress}`;

    const messageText = `*Gas:* ${formattedGasPrice} Gwei  ▰  *Block:* ${blockNumber}  ▰  *ETH:* $${ethPrice} \n\n` +
                        `🟨  *Blastie bot*  🟨\n\n` +
                        `═══ *Wallet address* ═══\n\n\`${user.walletAddress}\`\n\n` +
                        `*ETH balance:* \`⟠${parseFloat(ethBalance).toFixed(3)} ETH \`\n` +
                        `*Point Earned:* \`${user.points} points\`\n\n`+
                        `[Tornado](https://t.me/TornadoBlastBot)`;
                       
                        

    const sentMessage = await bot.sendMessage(chatId, messageText, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Create tokens 👨‍🍳', callback_data: 'create_tokens' },
                { text: 'Manage tokens 🔧', callback_data: 'manage_tokens' }],
                [{ text: 'Settings ⚙️', callback_data: 'settings' }]
            ],
        }
    });

    if (userSession) {
        userSession.mainMenuMessageId = sentMessage.message_id;
        await redisClient.set(`session:${user.userId}`, JSON.stringify(userSession));
    }

}

// Function to Show Start Menu
async function showStartMenu(chatId) {
    bot.sendMessage(chatId, `[𝕏](https://twitter.com/blastiebot) - [Blastscan](https://testnet.blastscan.io/) - [Blasthub 𝕏](https://twitter.com/blasthub_) \n\n` +
        `Welcome to the Blastie Bot! 🟨 \n\n` +
    `Blastie Bot allow you to deploy a token under 1 min on Blast L2. \n\n`+
    `Click the button below to create a wallet and get started!`, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Create Wallet', callback_data: 'create_wallet' }]
            ]
        }
    });
}
////////////// STANDARD TOKEN ///////////////////




async function showStandardTokenParameters(chatId, userId) {

    const sessionData = await redisClient.get(`session:${userId}`);
        
        if (!sessionData) {
            console.log("No session found for userId:", userId);
            // Optionally, initialize a session here if it should exist
            await initializeUserSession(userId);
            return;
        }

    const userSession = JSON.parse(sessionData);

    console.log("userSession:", userSession);

    const gasPrice = await provider.getGasPrice();
    const gasPriceInGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei')).toFixed(4);

    // Convert gas price to ETH for the given gas limit (assuming a fixed gas limit for deployment)
    const gasLimit = ethers.BigNumber.from("100000"); // Example gas limit, adjust as needed
    const gasCostInETH = parseFloat(ethers.utils.formatUnits(gasPrice.mul(gasLimit), 'ether')).toFixed(4);

    // Define other costs
    const deployCostInETH = parseFloat("0.003").toFixed(4); // Example deploy cost in ETH
    const serviceFeeInETH = parseFloat("0.0").toFixed(4); // Example service fee in ETH

    // Calculate total cost
    const totalCostInETH = parseFloat(ethers.utils.formatEther(
        ethers.utils.parseEther(deployCostInETH)
        .add(ethers.utils.parseEther(serviceFeeInETH))
        .add(gasPrice.mul(gasLimit))
    )).toFixed(4);

    let chainButtonText = userSession.chain.startsWith("Blast") ? `✅ ${userSession.chain}` : "Chain";
    let nameButtonText =! userSession.name.startsWith("Not") ? "✅ Token Name" : "Token Name";
    let symbolButtonText =! userSession.symbol.startsWith("Not") ? "✅ Symbol" : "Symbol";
    let supplyButtonText =! userSession.supply.startsWith("Not") ? "✅ Supply" : "Supply";
    let allSocialsFilled = !userSession.website.startsWith("Not") &&
                           !userSession.telegram.startsWith("Not") &&
                           !userSession.twitter.startsWith("Not") &&
                           !userSession.description.startsWith("Not");
    let socialsButtonText = allSocialsFilled ? "✅ Socials" : "Socials";
    
    
    
    let messageText = `*Standard token parameters:*\n\n` +
                      `*Chain:* \`${userSession.chain}\`\n` +
                      `*Name:* \`${userSession.name}\`\n` +
                      `*Symbol:* \`${userSession.symbol}\`\n` +
                      `*Supply:* \`${userSession.supply}\`\n` +
                      `*Website:* \`${userSession.website}\`\n` +
                      `*Telegram:* \`${userSession.telegram}\`\n` +
                      `*Twitter:* \`${userSession.twitter}\`\n` +
                      `*Description:* \`${userSession.description}\`\n` +
                      `----------------------------\n` +
                      `*Gwei:* \`${gasPriceInGwei}\` Gwei\n` +
                      `*Deploy cost:* \`${deployCostInETH}\` ETH \n` +
                      `*Service Fee:* \`${serviceFeeInETH}\` ETH \n` +
                      `*Total:* \`${totalCostInETH}\` ETH\n`+
                      `----------------------------\n` +
                      `⚠️ Please update all the fields for a successful deployment 🤖`
                      
                      ;


    if (userSession.standardTokenParamsMessageId) {
        bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: userSession.standardTokenParamsMessageId,
            parse_mode:"Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: chainButtonText, callback_data: 'set_chain' },
                     { text: nameButtonText, callback_data: 'set_name' }],
                    [{ text: symbolButtonText, callback_data: 'set_symbol' },
                     { text: supplyButtonText, callback_data: 'set_supply' }],
                    [{ text: socialsButtonText, callback_data: 'set_socials' }],
                    [{ text: 'Home 🏠', callback_data: 'go_home' },
                     { text: 'Deploy 🚀', callback_data: 'deploy_token' }]
                ]
            }
        });
    } else {
        const sentMessage = await bot.sendMessage(chatId, messageText, {
            parse_mode:"Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: chainButtonText, callback_data: 'set_chain' },
                     { text: nameButtonText, callback_data: 'set_name' }],
                    [{ text: symbolButtonText, callback_data: 'set_symbol' },
                     { text: supplyButtonText, callback_data: 'set_supply' }],
                    [{ text: socialsButtonText, callback_data: 'set_socials' }],
                    [{ text: 'Home 🏠', callback_data: 'go_home' },
                     { text: 'Deploy 🚀', callback_data: 'deploy_token' }]
                ]
            }
        });
        
        userSession.standardTokenParamsMessageId = sentMessage.message_id; // Store the message ID for future updates
        // Save the updated session back to Redis
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
    }



}



async function showSocialsParameters(chatId, userId) {

    const sessionData = await redisClient.get(`session:${userId}`);
        
        if (!sessionData) {
            console.log("No session found for userId:", userId);
            // Optionally, initialize a session here if it should exist
            await initializeUserSession(userId);
            return;
        }

    const userSession = JSON.parse(sessionData);

    console.log("userSession:", userSession);

    let websiteButtonText =! userSession.website.startsWith("Not") ? "✅ Website" : "Website";
    let telegramButtonText =! userSession.telegram.startsWith("Not") ? "✅ Telegram" : "Telegram";
    let twitterButtonText =! userSession.twitter.startsWith("Not") ? "✅ Twitter" : "Twitter";
    let desButtonText =! userSession.description.startsWith("Not") ? "✅ Description" : "Description";
    


    let messageText = `*Update socials*\n\n` +
                      `*Website:* \`${userSession.website}\`\n` +
                      `*Telegram:* \`${userSession.telegram}\`\n` +
                      `*Twitter:* \`${userSession.twitter}\`\n` +
                      `*Description:* \`${userSession.description}\`\n`;
    
    
                      if (userSession.standardTokenParamsMessageId) {
                        bot.editMessageText(messageText, {
                            chat_id: chatId,
                            message_id: userSession.standardTokenParamsMessageId,
                            parse_mode:"MarkdownV2",
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: websiteButtonText, callback_data: 'set_website' },
                                     { text: telegramButtonText, callback_data: 'set_telegram' }],
                                    [{ text: twitterButtonText, callback_data: 'set_twitter' },
                                     { text: desButtonText, callback_data: 'set_description' }],
                                    [{ text: 'Back ↩️', callback_data: 'go_back' }]
                                ]
                            }
                        });
                    } else {

                        const sentMessage = await bot.sendMessage(chatId, messageText, {
                            parse_mode: "MarkdownV2",
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: websiteButtonText, callback_data: 'set_website' },
                                     { text: telegramButtonText, callback_data: 'set_telegram' }],
                                    [{ text: twitterButtonText, callback_data: 'set_twitter' },
                                     { text: desButtonText, callback_data: 'set_description' }],
                                    [{ text: 'Back ↩️', callback_data: 'go_back' }]
                                ]
                            }
                        });
                        userSession.standardTokenParamsMessageId = sentMessage.message_id; // Update the message ID for future reference
                        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
                    }
}



//////////// CUSTOM TOKEN ///////////////////



async function showCustomTokenParameters(chatId, userId) {

    const sessionData = await redisClient.get(`session:${userId}`);
        
        if (!sessionData) {
            console.log("No session found for userId:", userId);
            // Optionally, initialize a session here if it should exist
            await initializeUserSession(userId);
            return;
        }

    const userSession = JSON.parse(sessionData);

    console.log("userSession:", userSession);

    const gasPrice = await provider.getGasPrice();
    const gasPriceInGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei')).toFixed(4);

    // Convert gas price to ETH for the given gas limit (assuming a fixed gas limit for deployment)
    const gasLimit = ethers.BigNumber.from("100000"); // Example gas limit, adjust as needed
    const gasCostInETH = parseFloat(ethers.utils.formatUnits(gasPrice.mul(gasLimit), 'ether')).toFixed(4);

    // Define other costs
    const deployCostInETH = parseFloat("0.003").toFixed(4); // Example deploy cost in ETH
    const serviceFeeInETH = parseFloat("0.0").toFixed(4); // Example service fee in ETH

    // Calculate total cost
    const totalCostInETH = parseFloat(ethers.utils.formatEther(
        ethers.utils.parseEther(deployCostInETH)
        .add(ethers.utils.parseEther(serviceFeeInETH))
        .add(gasPrice.mul(gasLimit))
    )).toFixed(4);

    let chainButtonText = userSession.chain.startsWith("Blast") ? `✅ ${userSession.chain}` : "Chain";
    let nameButtonText =! userSession.name.startsWith("Not") ? "✅ Token Name" : "Token Name";
    let symbolButtonText =! userSession.symbol.startsWith("Not") ? "✅ Symbol" : "Symbol";
    let supplyButtonText =! userSession.supply.startsWith("Not") ? "✅ Supply" : "Supply";

    let allBuyTaxFilled = !userSession.buyTax.reflection.startsWith("Not") &&
                           !userSession.buyTax.liquidity.startsWith("Not") &&
                           !userSession.buyTax.marketing.startsWith("Not") &&
                           !userSession.buyTax.burn.startsWith("Not");
    let buyTaxButtonText = allBuyTaxFilled ? "✅ Buy Tax" : "Buy Tax";

     let allSellTaxFilled = !userSession.sellTax.reflection.startsWith("Not") &&
                           !userSession.sellTax.liquidity.startsWith("Not") &&
                           !userSession.sellTax.marketing.startsWith("Not") &&
                           !userSession.sellTax.burn.startsWith("Not");
    let sellTaxButtonText = allSellTaxFilled ? "✅ Sell Tax" : "Sell Tax";

     let allLimitFilled = !userSession.txnLimit.MaxBuyTxnAmount.startsWith("Not") &&
                           !userSession.txnLimit.MaxSellTxnAmount.startsWith("Not") &&
                           !userSession.txnLimit.MaxWalletAmount.startsWith("Not") &&
                           !userSession.MarketingWallet.startsWith("Not");
    let limitButtonText = allLimitFilled ? "✅ Txn Limits" : "Txn Limits";


    let allSocialsFilled = !userSession.website.startsWith("Not") &&
                           !userSession.telegram.startsWith("Not") &&
                           !userSession.twitter.startsWith("Not") &&
                           !userSession.description.startsWith("Not");
    let socialsButtonText = allSocialsFilled ? "✅ Socials" : "Socials";
    
    
    
    let messageText = `*Standard token parameters:*\n\n` +
                      `*Chain:* \`${userSession.chain}\`\n` +
                      `*Name:* \`${userSession.name}\`\n` +
                      `*Symbol:* \`${userSession.symbol}\`\n` +
                      `*Supply:* \`${userSession.supply}\`\n\n` +
                      `*Buy Tax:*\n` +
                      `*Reflection:* \`${userSession.buyTax.reflection}\`\n`+
                      `*Liquidity:* \`${userSession.buyTax.liquidity}\`\n`+
                      `*Marketing:* \`${userSession.buyTax.marketing}\`\n`+
                      `*Burn:* \`${userSession.buyTax.burn}\`\n\n`+

                      `*Sell Tax:*\n` +
                      `*Reflection:* \`${userSession.sellTax.reflection}\`\n`+
                      `*Liquidity:* \`${userSession.sellTax.liquidity}\`\n`+
                      `*Marketing:* \`${userSession.sellTax.marketing}\`\n`+
                      `*Burn:* \`${userSession.sellTax.burn}\`\n`+

                      `*Limits:*\n` +
                      `*Max buy:* \`${userSession.txnLimit.MaxBuyTxnAmount}\`\n`+
                      `*Max sell:* \`${userSession.txnLimit.MaxSellTxnAmount}\`\n`+
                      `*Max wallet:* \`${userSession.txnLimit.MaxWalletAmount}\`\n\n`+
                      `*Marketing wallet:* \`${userSession.MarketingWallet}\`\n`+

                      `*Website:* \`${userSession.website}\`\n` +
                      `*Telegram:* \`${userSession.telegram}\`\n` +
                      `*Twitter:* \`${userSession.twitter}\`\n` +
                      `*Description:* \`${userSession.description}\`\n` +
                      `----------------------------\n` +
                      `*Gwei:* \`${gasPriceInGwei}\` Gwei\n` +
                      `*Deploy cost:* \`${deployCostInETH}\` ETH \n` +
                      `*Service Fee:* \`${serviceFeeInETH}\` ETH \n` +
                      `*Total:* \`${totalCostInETH}\` ETH\n`+
                      `----------------------------\n` +
                      `⚠️ Please update all the fields for a successful deployment 🤖`
                      
                      ;


    if (userSession.customTokenParamsMessageId) {
        bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: userSession.customTokenParamsMessageId,
            parse_mode:"Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: chainButtonText, callback_data: 'set_chain_custom' },
                     { text: nameButtonText, callback_data: 'set_name_custom' }],
                    [{ text: symbolButtonText, callback_data: 'set_symbol_custom' },
                     { text: supplyButtonText, callback_data: 'set_supply_custom' }],
                     [{ text: buyTaxButtonText, callback_data: 'set_buytax' },
                     { text: sellTaxButtonText, callback_data: 'set_selltax' }],
                     [{ text: limitButtonText, callback_data: 'set_limit' }],
                    [{ text: socialsButtonText, callback_data: 'set_socials_custom' }],
                    [{ text: 'Home 🏠', callback_data: 'go_home' },
                     { text: 'Deploy 🚀', callback_data: 'deploy_token_custom' }]
                ]
            }
        });
    } else {
        const sentMessage = await bot.sendMessage(chatId, messageText, {
            parse_mode:"Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: chainButtonText, callback_data: 'set_chain_custom' },
                     { text: nameButtonText, callback_data: 'set_name_custom' }],
                    [{ text: symbolButtonText, callback_data: 'set_symbol_custom' },
                     { text: supplyButtonText, callback_data: 'set_supply_custom' }],
                     [{ text: buyTaxButtonText, callback_data: 'set_buytax' },
                     { text: sellTaxButtonText, callback_data: 'set_selltax' }],
                     [{ text: limitButtonText, callback_data: 'set_limit' }],
                    [{ text: socialsButtonText, callback_data: 'set_socials_custom' }],
                    [{ text: 'Home 🏠', callback_data: 'go_home' },
                     { text: 'Deploy 🚀', callback_data: 'deploy_token_custom' }]
                ]
            }
        });
        
        userSession.customTokenParamsMessageId = sentMessage.message_id; // Store the message ID for future updates
        // Save the updated session back to Redis
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
    }



}


async function showBuyTaxParameters(chatId, userId) {

    console.log("inside showBuyTaxParameters");

    const sessionData = await redisClient.get(`session:${userId}`);
        
        if (!sessionData) {
            console.log("No session found for userId:", userId);
            // Optionally, initialize a session here if it should exist
            await initializeUserSession(userId);
            return;
        }

    const userSession = JSON.parse(sessionData);

    console.log("userSession:", userSession);

    let refButtonText =! userSession.buyTax.reflection.startsWith("Not") ? "✅ Reflection" : "Reflection";
    let liqButtonText =! userSession.buyTax.liquidity.startsWith("Not") ? "✅ Liquidity" : "Liquidity";
    let marButtonText =! userSession.buyTax.marketing.startsWith("Not") ? "✅ Marketing" : "Marketing";
    let burButtonText =! userSession.buyTax.burn.startsWith("Not") ? "✅ Burn" : "Burn";
    


    let messageText = `*Update Buy Tax*\n\n` +
                      `*Reflection:* \`${userSession.buyTax.reflection}\` % \n` +
                      `*Liquidity:* \`${userSession.buyTax.liquidity}\` % \n` +
                      `*Marketing:* \`${userSession.buyTax.marketing}\` % \n` +
                      `*Burn:* \`${userSession.buyTax.burn}\` % \n\n`+
                      `*Reflection:* % distributed among holders\n`+
                    `*Liquidity:* % added to the liquidity pool\n`+
                    `*Marketing:* % goes to the marketing wallet\n`+
                    `*Burn:* % permanently burned\n\n`+
                      `*Please note:* For a successful deployment, all fields must be completed & Make sure Buy Tax that represents the total percentage should not exceed 30%`;

    
    
                      if (userSession.customTokenParamsMessageId) {
                        bot.editMessageText(messageText, {
                            chat_id: chatId,
                            message_id: userSession.customTokenParamsMessageId,
                            parse_mode:"MarkdownV2",
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: refButtonText, callback_data: 'set_buy_reflection' },
                                     { text: liqButtonText, callback_data: 'set_buy_liquidity' }],
                                    [{ text: marButtonText, callback_data: 'set_buy_marketing' },
                                     { text: burButtonText, callback_data: 'set_buy_burn' }],
                                    [{ text: 'Back ↩️', callback_data: 'go_back_custom' }]
                                ]
                            }
                        });
                    } else {

                        const sentMessage = await bot.sendMessage(chatId, messageText, {
                            parse_mode: "MarkdownV2",
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: refButtonText, callback_data: 'set_buy_reflection' },
                                     { text: liqButtonText, callback_data: 'set_buy_liquidity' }],
                                    [{ text: marButtonText, callback_data: 'set_buy_marketing' },
                                     { text: burButtonText, callback_data: 'set_buy_burn' }],
                                    [{ text: 'Back ↩️', callback_data: 'go_back_custom' }]
                                ]
                            }
                        });
                        userSession.customTokenParamsMessageId = sentMessage.message_id; // Update the message ID for future reference
                        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
                    }
}


async function showSellTaxParameters(chatId, userId) {

    const sessionData = await redisClient.get(`session:${userId}`);
        
        if (!sessionData) {
            console.log("No session found for userId:", userId);
            // Optionally, initialize a session here if it should exist
            await initializeUserSession(userId);
            return;
        }

    const userSession = JSON.parse(sessionData);

    console.log("userSession:", userSession);

    let refButtonText =! userSession.sellTax.reflection.startsWith("Not") ? "✅ Reflection" : "Reflection";
    let liqButtonText =! userSession.sellTax.liquidity.startsWith("Not") ? "✅ Liquidity" : "Liquidity";
    let marButtonText =! userSession.sellTax.marketing.startsWith("Not") ? "✅ Marketing" : "Marketing";
    let burButtonText =! userSession.sellTax.burn.startsWith("Not") ? "✅ Burn" : "Burn";
    


    let messageText = `*Update Sell Tax*\n\n` +
                      `*Reflection:* \`${userSession.sellTax.reflection}\` % \n` +
                      `*Liquidity:* \`${userSession.sellTax.liquidity}\` % \n` +
                      `*Marketing:* \`${userSession.sellTax.marketing}\` % \n` +
                      `*Burn:* \`${userSession.sellTax.burn}\` % \n\n`+
                      `*Reflection:* % distributed among holders\n`+
                    `*Liquidity:* % added to the liquidity pool\n`+
                    `*Marketing:* % goes to the marketing wallet\n`+
                    `*Burn:* % permanently burned\n\n`+
                    `*Please note:* For a successful deployment, all fields must be completed & Make sure Sell Tax that represents the total percentage should not exceed 30%`;
    
    
                      if (userSession.customTokenParamsMessageId) {
                        bot.editMessageText(messageText, {
                            chat_id: chatId,
                            message_id: userSession.customTokenParamsMessageId,
                            parse_mode:"MarkdownV2",
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: refButtonText, callback_data: 'set_sell_reflection' },
                                     { text: liqButtonText, callback_data: 'set_sell_liquidity' }],
                                    [{ text: marButtonText, callback_data: 'set_sell_marketing' },
                                     { text: burButtonText, callback_data: 'set_sell_burn' }],
                                    [{ text: 'Back ↩️', callback_data: 'go_back_custom' }]
                                ]
                            }
                        });
                    } else {

                        const sentMessage = await bot.sendMessage(chatId, messageText, {
                            parse_mode: "MarkdownV2",
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: refButtonText, callback_data: 'set_sell_reflection' },
                                     { text: liqButtonText, callback_data: 'set_sell_liquidity' }],
                                    [{ text: marButtonText, callback_data: 'set_sell_marketing' },
                                     { text: burButtonText, callback_data: 'set_sell_burn' }],
                                    [{ text: 'Back ↩️', callback_data: 'go_back_custom' }]
                                ]
                            }
                        });
                        userSession.customTokenParamsMessageId = sentMessage.message_id; // Update the message ID for future reference
                        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
                    }
}



async function showLimitParameters(chatId, userId) {

    const sessionData = await redisClient.get(`session:${userId}`);
        
        if (!sessionData) {
            console.log("No session found for userId:", userId);
            // Optionally, initialize a session here if it should exist
            await initializeUserSession(userId);
            return;
        }

    const userSession = JSON.parse(sessionData);

    console.log("userSession:", userSession);

    let maxBuyButtonText =! userSession.txnLimit.MaxBuyTxnAmount.startsWith("Not") ? "✅ Max buy %" : "Max buy %";
    let maxSellButtonText =! userSession.txnLimit.MaxSellTxnAmount.startsWith("Not") ? "✅ Max sell %" : "Max sell %";
    let maxWalletButtonText =! userSession.txnLimit.MaxWalletAmount.startsWith("Not") ? "✅ Max wallet %" : "Max wallet %";
    let MktWalletButtonText =! userSession.MarketingWallet.startsWith("Not") ? "✅ Marketing wallet" : "Marketing wallet";
    


    let messageText = `*Update Limits*\n\n` +
                      `*Max buy:* \`${userSession.txnLimit.MaxBuyTxnAmount}\` % \n` +
                      `*Max sell:* \`${userSession.txnLimit.MaxSellTxnAmount}\` % \n` +
                      `*Max wallet:* \`${userSession.txnLimit.MaxWalletAmount}\` % \n` +
                      `*Marketing wallet:* \`${userSession.MarketingWallet}\` % \n\n`+
                      `Max Buy: Max buy % per transaction\n`+
                        `Max Sell: Max sell % per transaction\n`+
                        `Max wallet: Max % a wallet can hold\n\n`+
                        `*Please note:* For a successful deployment, all fields must be completed`;

    
    
                      if (userSession.customTokenParamsMessageId) {
                            console.log("bot message is ready to be edited");
                            bot.editMessageText(messageText, {
                                chat_id: chatId,
                                message_id: userSession.customTokenParamsMessageId,
                                parse_mode:"MarkdownV2",
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: maxBuyButtonText, callback_data: 'set_max_MaxBuyTxnAmount' },
                                        { text: maxSellButtonText, callback_data: 'set_max_MaxSellTxnAmount' }],
                                        [{ text: maxWalletButtonText, callback_data: 'set_max_MaxWalletAmount' },
                                        { text: MktWalletButtonText, callback_data: 'set_marketing_wallet' }],
                                        [{ text: 'Back ↩️', callback_data: 'go_back_custom' }]
                                    ]
                                }
                            });
                    } else {

                        console.log("bot message is ready to send a new message");

                        const sentMessage = await bot.sendMessage(chatId, messageText, {
                            parse_mode: "MarkdownV2",
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: maxBuyButtonText, callback_data: 'set_max_MaxBuyTxnAmount' },
                                    { text: maxSellButtonText, callback_data: 'set_max_MaxSellTxnAmount' }],
                                    [{ text: maxWalletButtonText, callback_data: 'set_max_MaxWalletAmount' },
                                    { text: MktWalletButtonText, callback_data: 'set_marketing_wallet' }],
                                    [{ text: 'Back ↩️', callback_data: 'go_back_custom' }]
                                ]
                            }
                        });
                        userSession.customTokenParamsMessageId = sentMessage.message_id; // Update the message ID for future reference
                        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
       }
}




async function showSocialsCustomParameters(chatId, userId) {

    const sessionData = await redisClient.get(`session:${userId}`);
        
        if (!sessionData) {
            console.log("No session found for userId:", userId);
            // Optionally, initialize a session here if it should exist
            await initializeUserSession(userId);
            return;
        }

    const userSession = JSON.parse(sessionData);

    console.log("userSession:", userSession);

    let websiteButtonText =! userSession.website.startsWith("Not") ? "✅ Website" : "Website";
    let telegramButtonText =! userSession.telegram.startsWith("Not") ? "✅ Telegram" : "Telegram";
    let twitterButtonText =! userSession.twitter.startsWith("Not") ? "✅ Twitter" : "Twitter";
    let desButtonText =! userSession.description.startsWith("Not") ? "✅ Description" : "Description";
    


    let messageText = `*Update socials*\n\n` +
                      `*Website:* \`${userSession.website}\`\n` +
                      `*Telegram:* \`${userSession.telegram}\`\n` +
                      `*Twitter:* \`${userSession.twitter}\`\n` +
                      `*Description:* \`${userSession.description}\`\n`;
    
    
                      if (userSession.customTokenParamsMessageId) {
                        bot.editMessageText(messageText, {
                            chat_id: chatId,
                            message_id: userSession.customTokenParamsMessageId,
                            parse_mode:"MarkdownV2",
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: websiteButtonText, callback_data: 'set_custom_website' },
                                     { text: telegramButtonText, callback_data: 'set_custom_telegram' }],
                                    [{ text: twitterButtonText, callback_data: 'set_custom_twitter' },
                                     { text: desButtonText, callback_data: 'set_custom_description' }],
                                    [{ text: 'Back ↩️', callback_data: 'go_back_custom' }]
                                ]
                            }
                        });
                    } else {

                        const sentMessage = await bot.sendMessage(chatId, messageText, {
                            parse_mode: "MarkdownV2",
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: websiteButtonText, callback_data: 'set_custom_website' },
                                     { text: telegramButtonText, callback_data: 'set_custom_telegram' }],
                                    [{ text: twitterButtonText, callback_data: 'set_custom_twitter' },
                                     { text: desButtonText, callback_data: 'set_custom_description' }],
                                    [{ text: 'Back ↩️', callback_data: 'go_back_custom' }]
                                ]
                            }
                        });
                        userSession.customTokenParamsMessageId = sentMessage.message_id; // Update the message ID for future reference
                        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
                    }
}



// ERC 404




async function showERC404TokenParameters(chatId, userId) {

    const sessionData = await redisClient.get(`session:${userId}`);
        
        if (!sessionData) {
            console.log("No session found for userId:", userId);
            // Optionally, initialize a session here if it should exist
            await initializeUserSession(userId);
            return;
        }

    const userSession = JSON.parse(sessionData);

    console.log("userSession:", userSession);

    const gasPrice = await provider.getGasPrice();
    const gasPriceInGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei')).toFixed(4);

    // Convert gas price to ETH for the given gas limit (assuming a fixed gas limit for deployment)
    const gasLimit = ethers.BigNumber.from("100000"); // Example gas limit, adjust as needed
    const gasCostInETH = parseFloat(ethers.utils.formatUnits(gasPrice.mul(gasLimit), 'ether')).toFixed(4);

    // Define other costs
    const deployCostInETH = parseFloat("0.003").toFixed(4); // Example deploy cost in ETH
    const serviceFeeInETH = parseFloat("0.0").toFixed(4); // Example service fee in ETH

    // Calculate total cost
    const totalCostInETH = parseFloat(ethers.utils.formatEther(
        ethers.utils.parseEther(deployCostInETH)
        .add(ethers.utils.parseEther(serviceFeeInETH))
        .add(gasPrice.mul(gasLimit))
    )).toFixed(4);

    let chainButtonText = userSession.chain.startsWith("Blast") ? `✅ ${userSession.chain}` : "Chain";
    let nameButtonText =! userSession.name.startsWith("Not") ? "✅ Token Name" : "Token Name";
    let symbolButtonText =! userSession.symbol.startsWith("Not") ? "✅ Symbol" : "Symbol";
    let supplyButtonText =! userSession.supply.startsWith("Not") ? "✅ Supply" : "Supply";
    let baseuriButtonText =! userSession.baseuri.startsWith("Not") ? "✅ BaseURI" : "BaseURI";
   
    
    
    
    let messageText = `*ERC404 token parameters:*\n\n` +
                      `*Chain:* \`${userSession.chain}\`\n` +
                      `*Name:* \`${userSession.name}\`\n` +
                      `*Symbol:* \`${userSession.symbol}\`\n` +
                      `*Supply:* \`${userSession.supply}\`\n` +
                      `*BaseURI:* \`${userSession.baseuri}\`\n`+
                      `----------------------------\n` +
                      `*Gwei:* \`${gasPriceInGwei}\` Gwei\n` +
                      `*Deploy cost:* \`${deployCostInETH}\` ETH \n` +
                      `*Service Fee:* \`${serviceFeeInETH}\` ETH \n` +
                      `*Total:* \`${totalCostInETH}\` ETH\n`+
                      `----------------------------\n` +
                      `⚠️ Please update all the fields for a successful deployment 🤖`
                      
                      ;


    if (userSession.ERC404TokenParamsMessageId) {
        bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: userSession.ERC404TokenParamsMessageId,
            parse_mode:"Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: chainButtonText, callback_data: 'set_chain_ERC404' },
                     { text: nameButtonText, callback_data: 'set_name_ERC404' }],
                    [{ text: symbolButtonText, callback_data: 'set_symbol_ERC404' },
                     { text: supplyButtonText, callback_data: 'set_supply_ERC404' }],
                    [{ text: baseuriButtonText, callback_data: 'set_baseuri' }],
                    [{ text: 'Home 🏠', callback_data: 'go_home' },
                     { text: 'Deploy 🚀', callback_data: 'deploy_token_ERC404' }]
                ]
            }
        });
    } else {
        const sentMessage = await bot.sendMessage(chatId, messageText, {
            parse_mode:"Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: chainButtonText, callback_data: 'set_chain_ERC404' },
                     { text: nameButtonText, callback_data: 'set_name_ERC404' }],
                    [{ text: symbolButtonText, callback_data: 'set_symbol_ERC404' },
                     { text: supplyButtonText, callback_data: 'set_supply_ERC404' }],
                    [{ text: baseuriButtonText, callback_data: 'set_baseuri' }],
                    [{ text: 'Home 🏠', callback_data: 'go_home' },
                     { text: 'Deploy 🚀', callback_data: 'deploy_token_ERC404' }]
                ]
            }
        });
        
        userSession.ERC404TokenParamsMessageId = sentMessage.message_id; // Store the message ID for future updates
        // Save the updated session back to Redis
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
    }



}



redisClient.connect().then(() => {
    console.log('Connected to Redis');


    bot.on('message', (msg) => {
        // Check if the message is from a group
        if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
            console.log(`Group Chat ID: ${msg.chat.id}`);
        }
    });
    
    const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID; // Replace with actual group chat ID
    
    // Handler for new chat members
    bot.on('new_chat_members', async (msg) => {
        if (msg.chat.id.toString() === GROUP_CHAT_ID) {
            const userId = msg.from.id;
            // Add or update the user in the database as a group member
            await db.collection('users').updateOne(
                { userId },
                { $set: { isInGroup: true } },
                { upsert: true }
            );
        }
    });
    
    // Handler for when a user leaves the group
    bot.on('left_chat_member', async (msg) => {
        if (msg.chat.id.toString() === GROUP_CHAT_ID) {
            const userId = msg.from.id;
            // Update the user in the database as not a group member
            await db.collection('users').updateOne(
                { userId },
                { $set: { isInGroup: false } }
            );
        }
    });

    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
    
        // Deleting the existing session for a fresh start
        await redisClient.del(`session:${userId}`);
    
        // Initialize a new session
        await initializeUserSession(userId);
    
        // Retrieve the new session data
        const sessionData = await redisClient.get(`session:${userId}`);
        const userSession = JSON.parse(sessionData);
    
    
        // Check if the user is a member of the group and has a wallet
        const user = await db.collection('users').findOne({ userId });
    
        if (user && user.isInGroup) {
            if (user.walletAddress) {
                // User has a wallet, show the main menu
                await showMainMenu(chatId, user, userSession);
            } else {
                // User is in the group but doesn't have a wallet, send the welcome message with the 'Create Wallet' button
                bot.sendMessage(chatId, `[𝕏](https://twitter.com/blastiebot) - [Blastscan](https://testnet.blastscan.io/) - [Blasthub 𝕏](https://twitter.com/blasthub_) \n\n` +
                    `Welcome to the Blastie Bot! 🟨 \n\n` +
                    `Blastie Bot allows you to deploy a token under 1 min on Blast L2. \n\n` +
                    `Click the button below to create a wallet and get started!`, {
                    parse_mode: "Markdown",
                    disable_web_page_preview: true,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Create Wallet 🔧', callback_data: 'create_wallet' }]
                        ]
                    }
                });
            }
        } else {
            // User is not in the group, prompt them to join
            bot.sendMessage(chatId, 
                `Welcome to the Blastie bot!\n\n` +
                `You need to be a member of [@blast_hub](https://t.me/blast_hub) community to use this bot. Once you join, hit /start again.\n\n`,
                {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Join @blast_hub 🚀', url: 'https://t.me/blast_hub' }]
                        ]
                    }
                }
            );
        }
    });

// Handle Callback Queries
bot.on('callback_query', async (callbackQuery) => {


    const action = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const messageId = callbackQuery.message.message_id;
    const username = callbackQuery.from.username;

    const sessionData = await redisClient.get(`session:${userId}`);


        
    if (!sessionData) {
            console.log("No session found for userId:", userId);
            // Optionally, initialize a session here if it should exist
            await initializeUserSession(userId);
            return;
    }

    const userSession = JSON.parse(sessionData);

    if (action === 'create_wallet') {
        await bot.deleteMessage(chatId, messageId);
        // Generate Wallet and Encrypt Private Key
        const wallet = ethers.Wallet.createRandom();
        
        const encryptedPrivateKey = encrypt(wallet.privateKey);
    
        const existingUser = await db.collection('users').findOne({ userId });

        if (existingUser) {
            // User exists - update existing document
            await db.collection('users').updateOne(
                { userId },
                {
                    $set: {
                        username,
                        walletAddress: wallet.address,
                        tokenCreated: [],
                        points: 0,
                        encryptedPrivateKey: encryptedPrivateKey
                    }
                }
            );
        } else {
            // New user - create new document
            const newUser = {
                userId,
                username,
                walletAddress: wallet.address,
                tokenCreated: [],
                points: 0,
                encryptedPrivateKey: encryptedPrivateKey,
                isInGroup:true
            };
            await db.collection('users').insertOne(newUser);
        }

        const UpdatedUser = await db.collection('users').findOne({ userId });


        // Fetch the updated user and show the main menu
        
        await showMainMenu(chatId, UpdatedUser, userSession);
    }

    

    if (action === 'create_tokens') {
        const sentMessage = await bot.sendMessage(chatId, 
            "*Standard token:* This is a simple contract with no taxes.\n\n" +
            "*Advanced token:* This token contract includes features like taxes, Max txn limit, Max wallet limit, etc.\n\n"+
            "*ERC-404 token:* It's an unofficial token standard (by pandora team) that seamlessly blends the features of ERC-20 and ERC-721 tokens. This unique standard enables NFTs to be effortlessly divided into smaller parts and traded just like ERC-20 tokens on Dex.",
            { 
                parse_mode:"Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Standard', callback_data: 'create_standard_token' },
                        { text: 'Advanced', callback_data: 'create_custom_token' }],
                        [{ text: 'ERC404 ( Experimental )', callback_data: 'create_erc404_token' }],
                        [{ text: 'Home 🏠', callback_data: 'go_home' }]
                    ]
                }
            }
        );
        userSession.standardTokenParamsMessageId = sentMessage.message_id;
        userSession.customTokenParamsMessageId = sentMessage.message_id;
        // Save the updated session back to Redis
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
    }

        // Logic for creating a standard token
   
        // Logic for creating a custom token
    if (action === 'go_home') {
        const user = await db.collection('users').findOne({ userId });
        await showMainMenu(chatId, user, userSession);
    }

    if (callbackQuery.data === 'create_standard_token') {
        
        await showStandardTokenParameters(chatId, userId);
    }

    if (callbackQuery.data === 'create_custom_token') {
        
        await showCustomTokenParameters(chatId, userId);
    }

    if (callbackQuery.data === 'create_erc404_token') {
        
        await showERC404TokenParameters(chatId, userId);
    }

    

    if (callbackQuery.data === 'set_chain') {
        // Show options for chain selection
        const sentMessage = await bot.sendMessage(chatId, "Choose a chain:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Blast-Test', callback_data: 'choose_chain_Blast-Test' }],
                    [{ text: 'Blast-main (Soon)', callback_data: 'choose_chain_Blast-main' }]
                ]
            }
        });
        userSession.chooseChainMessageId = sentMessage.message_id;

        // Save the updated session back to Redis
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));

    } else if (callbackQuery.data.startsWith('choose_chain_')) {

        if (userSession && userSession.chooseChainMessageId) {
            await bot.deleteMessage(chatId, userSession.chooseChainMessageId);
            delete userSession.chooseChainMessageId; // Remove the stored message ID
        }

        // Update chain in user session
        const chosenChain = callbackQuery.data.split('_')[2];
        userSession.chain = chosenChain;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        await showStandardTokenParameters(chatId, userId);
    }


    
    if (callbackQuery.data === 'set_chain_custom') {
        // Show options for chain selection
        const sentMessage = await bot.sendMessage(chatId, "Choose a chain:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Blast-Test', callback_data: 'choose_custom_chain_Blast-Test' }],
                    [{ text: 'Blast-main (Soon)', callback_data: 'choose_custom_chain_Blast-main' }]
                ]
            }
        });
        userSession.chooseChainMessageId = sentMessage.message_id;

        // Save the updated session back to Redis
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));

    } else if (callbackQuery.data.startsWith('choose_custom_')) {

        if (userSession && userSession.chooseChainMessageId) {
            await bot.deleteMessage(chatId, userSession.chooseChainMessageId);
            delete userSession.chooseChainMessageId; // Remove the stored message ID
        }

        // Update chain in user session
        const chosenChain = callbackQuery.data.split('_')[3];
        userSession.chain = chosenChain;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        await showCustomTokenParameters(chatId, userId);
    }


    if (callbackQuery.data === 'set_chain_ERC404') {
        // Show options for chain selection
        const sentMessage = await bot.sendMessage(chatId, "Choose a chain:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Blast-Test', callback_data: 'choose_ERC404_chain_Blast-Test' }],
                    [{ text: 'Blast-main (Soon)', callback_data: 'choose_ERC404_chain_Blast-main' }]
                ]
            }
        });
        userSession.chooseChainMessageId = sentMessage.message_id;

        // Save the updated session back to Redis
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));

    } else if (callbackQuery.data.startsWith('choose_ERC404_')) {

        if (userSession && userSession.chooseChainMessageId) {
            await bot.deleteMessage(chatId, userSession.chooseChainMessageId);
            delete userSession.chooseChainMessageId; // Remove the stored message ID
        }

        // Update chain in user session
        const chosenChain = callbackQuery.data.split('_')[3];
        userSession.chain = chosenChain;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        await showERC404TokenParameters(chatId, userId);
    }





    if (callbackQuery.data === 'set_name') {
        userSession.currentState = 'awaiting_token_name';
        const sentMessage = await bot.sendMessage(chatId, "Enter token name:");
        userSession.namePromptMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        console.log("userSession while user click on token name:", userSession);
        
    }


    if (callbackQuery.data === 'set_marketing_wallet') {
        userSession.currentState = 'awaiting_marketing_wallet';
        const sentMessage = await bot.sendMessage(chatId, "Enter Marketing wallet address:");
        userSession.marketingWalletPromptMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        
        
    }

    if (callbackQuery.data === 'set_name_custom') {
        userSession.currentState = 'awaiting_token_name_custom';
        const sentMessage = await bot.sendMessage(chatId, "Enter token name:");
        userSession.namePromptcustomMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        console.log("userSession while user click on token name:", userSession);
        
    }

    if (callbackQuery.data === 'set_name_ERC404') {
        userSession.currentState = 'awaiting_token_name_ERC404';
        const sentMessage = await bot.sendMessage(chatId, "Enter token name:");
        userSession.nameERC404PromptMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        console.log("userSession while user click on token name:", userSession);
        
    }

    if (callbackQuery.data === 'set_symbol') {
        console.log("Setting state to awaiting_token_symbol for user:", userId);
        userSession.currentState = 'awaiting_token_symbol';
        const sentMessage = await bot.sendMessage(chatId, "Enter token symbol:");
        userSession.symbolPromptMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        console.log("userSession while user click on symbol name:", userSession);
    }

    if (callbackQuery.data === 'set_symbol_custom') {
        console.log("Setting state to awaiting_token_symbol for user:", userId);
        userSession.currentState = 'awaiting_token_symbol_custom';
        const sentMessage = await bot.sendMessage(chatId, "Enter token symbol:");
        userSession.symbolPromptcustomMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        console.log("userSession while user click on symbol name:", userSession);
    }

    if (callbackQuery.data === 'set_symbol_ERC404') {
        console.log("Setting state to awaiting_token_symbol for user:", userId);
        userSession.currentState = 'awaiting_token_symbol_ERC404';
        const sentMessage = await bot.sendMessage(chatId, "Enter token symbol:");
        userSession.symbolERC404PromptMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        console.log("userSession while user click on symbol name:", userSession);
    }

    if (callbackQuery.data === 'set_supply') {
        userSession.currentState = 'awaiting_token_supply';
        const sentMessage = await bot.sendMessage(chatId, "Enter token supply:");
        userSession.supplyPromptMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
    }

    if (callbackQuery.data === 'set_supply_custom') {
        userSession.currentState = 'awaiting_token_supply_custom';
        const sentMessage = await bot.sendMessage(chatId, "Enter token supply:");
        userSession.supplyPromptcustomMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
    }

    if (callbackQuery.data === 'set_supply_ERC404') {
        userSession.currentState = 'awaiting_token_supply_ERC404';
        const sentMessage = await bot.sendMessage(chatId, "Enter token supply:");
        userSession.supplyERC404PromptMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
    }

    if (callbackQuery.data === 'set_baseuri') {
        userSession.currentState = 'awaiting_baseuri';
        const sentMessage = await bot.sendMessage(chatId, "Enter Base URI of NFT collection:");
        userSession.baseuriPromptMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
    }

    if (callbackQuery.data === 'set_socials') {
        await showSocialsParameters(chatId, userId);
    }

    if (callbackQuery.data === 'set_buytax') {
        await showBuyTaxParameters(chatId, userId);
    }

    if (callbackQuery.data === 'set_selltax') {
        await showSellTaxParameters(chatId, userId);
    }

    if (callbackQuery.data === 'set_socials_custom') {
        await showSocialsCustomParameters(chatId, userId);
    }

    if (callbackQuery.data === 'set_limit') {
        await showLimitParameters(chatId, userId);
    }
  


    if (callbackQuery.data === 'manage_tokens') {
        handleManageTokens(chatId, userId);
    }
    

    if (['set_website', 'set_telegram', 'set_twitter', 'set_description'].includes(callbackQuery.data)) {
        userSession.currentState = callbackQuery.data;
        const sentMessage = await bot.sendMessage(chatId, `Enter ${callbackQuery.data.split('_')[1]}:`);
        userSession.socialPromptMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));

    } else if (callbackQuery.data === 'go_back') {
        await showStandardTokenParameters(chatId, userId);
    }

    if (['set_custom_website', 'set_custom_telegram', 'set_custom_twitter', 'set_custom_description'].includes(callbackQuery.data)) {
        userSession.currentState = callbackQuery.data;
        const sentMessage = await bot.sendMessage(chatId, `Enter ${callbackQuery.data.split('_')[2]}:`);
        userSession.socialPromptcustomMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));

    } 
    
    if (callbackQuery.data === 'go_back_custom') {
        await showCustomTokenParameters(chatId, userId);
    }


    if (['set_buy_reflection', 'set_buy_liquidity', 'set_buy_marketing', 'set_buy_burn'].includes(callbackQuery.data)) {
        userSession.currentState = callbackQuery.data;
        const sentMessage = await bot.sendMessage(chatId, `Enter ${callbackQuery.data.split('_')[2]} percentage:`);
        userSession.buyTaxPromptMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));

    } 
    if (['set_sell_reflection', 'set_sell_liquidity', 'set_sell_marketing', 'set_sell_burn'].includes(callbackQuery.data)) {
        userSession.currentState = callbackQuery.data;
        const sentMessage = await bot.sendMessage(chatId, `Enter ${callbackQuery.data.split('_')[2]} percentage:`);
        userSession.sellTaxPromptMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));

    } 

    if (['set_max_MaxBuyTxnAmount', 'set_max_MaxSellTxnAmount', 'set_max_MaxWalletAmount'].includes(callbackQuery.data)) {
        console.log("button click", callbackQuery.data);
        userSession.currentState = callbackQuery.data;
        const sentMessage = await bot.sendMessage(chatId, `Enter ${callbackQuery.data.split('_')[2]} percentage:`);
        console.log("message id for call back query", sentMessage.message_id);
        userSession.maxLimitPromptMessageId = sentMessage.message_id;
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        console.log("userSession.maxLimitPromptMessageId:", userSession.maxLimitPromptMessageId);

    } 

    if (callbackQuery.data === 'deploy_token') {
    
        // Check if all required fields are filled
        const requiredFields = ['chain', 'name', 'symbol', 'supply'];
        const missingField = requiredFields.find(field => userSession[field] === "Not set");
    
        if (missingField) {
            // Notify user about the missing field
            bot.sendMessage(chatId, `${missingField.charAt(0).toUpperCase() + missingField.slice(1)} is required for deployment but you have missed it.`);
        } else if (userSession.standardTokenParamsMessageId) {
            // Proceed with the deployment process
            bot.editMessageText(`*Are you sure you want to proceed with the deployment?*\n\n`+
            `The deployment process will take a few seconds, so please hold tight! \n\n *Click on 'Confirm' to continue.*`, {
                chat_id: chatId,
                message_id: userSession.standardTokenParamsMessageId,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Confirm ✅', callback_data: 'confirm_deploy' }],
                        [{ text: 'Back ↩️', callback_data: 'go_back' }]
                    ]
                }
            });
        } else {
            const user = await db.collection('users').findOne({ userId });
            // Handle the case where the message ID is not available
            bot.sendMessage(chatId, "Seems like the last session has been expired for some reason. Please restart again. We are sorry for the inconvenience.")
            .then(() => {
                showMainMenu(chatId, user, userSession); // Assuming showMainMenu is a function that displays the main menu
            });
        }
    }


    if (callbackQuery.data === 'deploy_token_custom') {
    
        // Check if all required fields are filled
        const requiredFields = ['chain', 'name', 'symbol', 'supply'];
        const missingField = requiredFields.find(field => userSession[field] === "Not set");
    
        if (missingField) {
            // Notify user about the missing field
            bot.sendMessage(chatId, `${missingField.charAt(0).toUpperCase() + missingField.slice(1)} is required for deployment but you have missed it.`);
        } else if (userSession.customTokenParamsMessageId) {
            // Proceed with the deployment process
            bot.editMessageText(`*Are you sure you want to proceed with the deployment?*\n\n`+
            `The deployment process will take a few seconds, so please hold tight! \n\n *Click on 'Confirm' to continue.*`, {
                chat_id: chatId,
                message_id: userSession.customTokenParamsMessageId,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Confirm ✅', callback_data: 'confirm_deploy_custom' }],
                        [{ text: 'Back ↩️', callback_data: 'go_back_custom' }]
                    ]
                }
            });
        } else {
            const user = await db.collection('users').findOne({ userId });
            // Handle the case where the message ID is not available
            bot.sendMessage(chatId, "Seems like the last session has been expired for some reason. Please restart again. We are sorry for the inconvenience.")
            .then(() => {
                showMainMenu(chatId, user, userSession); // Assuming showMainMenu is a function that displays the main menu
            });
        }
    }

    if (callbackQuery.data === 'deploy_token_ERC404') {
    
        // Check if all required fields are filled
        const requiredFields = ['chain', 'name', 'symbol', 'supply'];
        const missingField = requiredFields.find(field => userSession[field] === "Not set");
    
        if (missingField) {
            // Notify user about the missing field
            bot.sendMessage(chatId, `${missingField.charAt(0).toUpperCase() + missingField.slice(1)} is required for deployment but you have missed it.`);
        } else if (userSession.ERC404TokenParamsMessageId) {
            // Proceed with the deployment process
            bot.editMessageText(`*Are you sure you want to proceed with the deployment?*\n\n`+
            `The deployment process will take a few seconds, so please hold tight! \n\n *Click on 'Confirm' to continue.*`, {
                chat_id: chatId,
                message_id: userSession.ERC404TokenParamsMessageId,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Confirm ✅', callback_data: 'confirm_deploy_ERC404' }],
                        [{ text: 'Back ↩️', callback_data: 'go_back_ERC404' }]
                    ]
                }
            });
        } else {
            const user = await db.collection('users').findOne({ userId });
            // Handle the case where the message ID is not available
            bot.sendMessage(chatId, "Seems like the last session has been expired for some reason. Please restart again. We are sorry for the inconvenience.")
            .then(() => {
                showMainMenu(chatId, user, userSession); // Assuming showMainMenu is a function that displays the main menu
            });
        }
    }


    if (action === 'confirm_deploy') {
        // First, edit the message to show "Deploying your contract..."
        bot.editMessageText("Deploying your contract...", {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id
        }).then(async () => {
            try {
                if (userSession) {
                    const contractAddress = await deployContract(
                        userSession.chain,
                        userSession.name, 
                        userSession.symbol, 
                        userSession.supply,
                        userSession.website, 
                        userSession.telegram, 
                        userSession.twitter,
                        userId
                    );
    
                    if (contractAddress) {
                        // Edit the message again to show the contract address
                        bot.editMessageText(`*Congrats!* Your contract has been deployed successfully!\n\n` +
                        `*Contract address:* \`${contractAddress}\`\n\n` +
                        `🔬*Verification:*: Your contract will be verified in 15 seconds\n\n` +
                        `🟡[View on Blastscan](https://testnet.blastscan.io/address/${contractAddress})\n\n`,
                        {
                            chat_id: chatId,
                            message_id: callbackQuery.message.message_id,
                            parse_mode: "Markdown",
                            disable_web_page_preview: true,
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: 'Manage Tokens 🔧', callback_data: 'manage_tokens' }],
                                    [{ text: 'Home 🏠', callback_data: 'return_main_menu' }]
                                ]
                            }
                        });
                    } else {
                        // If the contract address is not returned, handle the error
                        bot.sendMessage(chatId, "Failed to deploy the contract. Please try again.");
                    }
                } else {
                    const user = await db.collection('users').findOne({ userId });
                    bot.sendMessage(chatId, "Seems like the last session has expired for some reason. Please restart again. We are sorry for the inconvenience.")
                    .then(() => {
                        showMainMenu(chatId, user, userSession); // Assuming showMainMenu is a function that displays the main menu
                    });
                }
            } catch (error) {
                console.error('Deployment error:', error);
                bot.sendMessage(chatId, `Error deploying contract: ${error.message}`);
            }
        }).catch(error => {
            console.error('Error updating message:', error);
            bot.sendMessage(chatId, "An error occurred while updating the message. Please try again.");
        });
    }



    if (action === 'confirm_deploy_custom') {
        // First, edit the message to show "Deploying your contract..."
        bot.editMessageText("Deploying your contract...", {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id
        }).then(async () => {
            try {
                console.log("userSession", userSession);
                if (userSession) {
                    const contractAddress = await deployContractCustom(
                        userSession.chain,
                        userSession.name, 
                        userSession.symbol, 
                        userSession.supply,
                        userSession.buyTax.reflection,
                        userSession.sellTax.reflection,
                        userSession.buyTax.liquidity,
                        userSession.sellTax.liquidity,
                        userSession.buyTax.marketing,
                        userSession.sellTax.marketing,
                        userSession.buyTax.burn,
                        userSession.sellTax.burn,
                        userSession.MarketingWallet,
                        userSession.txnLimit.MaxBuyTxnAmount,
                        userSession.txnLimit.MaxSellTxnAmount,
                        userSession.txnLimit.MaxWalletAmount,
                        userSession.website, 
                        userSession.twitter,
                        userSession.telegram, 
                        userSession.description,
                        userId
                    );
    
                    if (contractAddress) {
                        // Edit the message again to show the contract address
                        bot.editMessageText(`*Congrats!* Your contract has been deployed successfully!\n\n` +
                        `*Contract address:* \`${contractAddress}\`\n\n` +
                        `🔬*Verification:*: Your contract will be verified in 15 seconds\n\n` +
                        `🟡[View on Blastscan](https://testnet.blastscan.io/address/${contractAddress})\n\n`,
                        {
                            chat_id: chatId,
                            message_id: callbackQuery.message.message_id,
                            parse_mode: "Markdown",
                            disable_web_page_preview: true,
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: 'Manage Tokens 🔧', callback_data: 'manage_tokens' }],
                                    [{ text: 'Home 🏠', callback_data: 'return_main_menu' }]
                                ]
                            }
                        });
                    } else {
                        // If the contract address is not returned, handle the error
                        bot.sendMessage(chatId, "Failed to deploy the contract. Please try again.");
                    }
                } else {
                    const user = await db.collection('users').findOne({ userId });
                    bot.sendMessage(chatId, "Seems like the last session has expired for some reason. Please restart again. We are sorry for the inconvenience.")
                    .then(() => {
                        showMainMenu(chatId, user, userSession); // Assuming showMainMenu is a function that displays the main menu
                    });
                }
            } catch (error) {
                console.error('Deployment error:', error);
                bot.sendMessage(chatId, `Error deploying contract: ${error.message}`);
            }
        }).catch(error => {
            console.error('Error updating message:', error);
            bot.sendMessage(chatId, "An error occurred while updating the message. Please try again.");
        });
    }



    if (action === 'confirm_deploy_ERC404') {
        // First, edit the message to show "Deploying your contract..."
        bot.editMessageText("Deploying your contract...", {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id
        }).then(async () => {
            try {
                if (userSession) {
                    const contractAddress = await deployContractERC404(
                        userSession.chain,
                        userSession.name, 
                        userSession.symbol, 
                        userSession.supply,
                        userSession.baseuri, 
                        userId
                    );
    
                    if (contractAddress) {
                        // Edit the message again to show the contract address
                        bot.editMessageText(`*Congrats!* Your contract has been deployed successfully!\n\n` +
                        `*Contract address:* \`${contractAddress}\`\n\n` +
                        `🔬*Verification:*: Your contract will be verified in 15 seconds\n\n` +
                        `🟡[View on Blastscan](https://testnet.blastscan.io/address/${contractAddress})\n\n`,
                        {
                            chat_id: chatId,
                            message_id: callbackQuery.message.message_id,
                            parse_mode: "Markdown",
                            disable_web_page_preview: true,
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: 'Manage Tokens 🔧', callback_data: 'manage_tokens' }],
                                    [{ text: 'Home 🏠', callback_data: 'return_main_menu' }]
                                ]
                            }
                        });
                    } else {
                        // If the contract address is not returned, handle the error
                        bot.sendMessage(chatId, "Failed to deploy the contract. Please try again.");
                    }
                } else {
                    const user = await db.collection('users').findOne({ userId });
                    bot.sendMessage(chatId, "Seems like the last session has expired for some reason. Please restart again. We are sorry for the inconvenience.")
                    .then(() => {
                        showMainMenu(chatId, user, userSession); // Assuming showMainMenu is a function that displays the main menu
                    });
                }
            } catch (error) {
                console.error('Deployment error:', error);
                bot.sendMessage(chatId, `Error deploying contract: ${error.message}`);
            }
        }).catch(error => {
            console.error('Error updating message:', error);
            bot.sendMessage(chatId, "An error occurred while updating the message. Please try again.");
        });
    }



    if (callbackQuery.data.startsWith('token_details_')) {
        const tokenIndex = parseInt(callbackQuery.data.split('_')[2]);
        displayTokenDetails(chatId, userId, tokenIndex);
    }


    if (action === 'settings') {
        const messageOptions = {
            chat_id: chatId,
            message_id: userSession.mainMenuMessageId, // Use the stored message ID
            text: "User settings ⚙️",
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Import private key 🔑', callback_data: 'import_private_key' }],
                    [{ text: 'Return  ↩️', callback_data: 'return_main_menu' }]
                ]
            }
        };
    
        if (userSession.mainMenuMessageId) {
            bot.editMessageText(messageOptions.text, messageOptions);
        } else {
            bot.sendMessage(chatId, messageOptions.text, {
                reply_markup: messageOptions.reply_markup
            });
        }

    } else if (action === 'import_private_key') {
        // Fetch user's encrypted private key from database
        const user = await db.collection('users').findOne({ userId });
        if (user && user.encryptedPrivateKey) {
            const privateKey = decryptPrivateKey(user.encryptedPrivateKey);
            bot.editMessageText(`*Private Key:*\n\n\`${privateKey}\``, {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [[{ text: 'Return  ↩️', callback_data: 'return_main_menu' }]]
                }
            });
        } else {
            bot.sendMessage(chatId, "Private key not found.");
        }
    } else if (action === 'return_main_menu') {

        // Clear userSession
        await redisClient.del(`session:${userId}`);


        const user = await db.collection('users').findOne({ userId });
        const balance = await provider.getBalance(user.walletAddress);
        const ethBalance = ethers.utils.formatEther(balance);
        const { gasPrice, blockNumber } = await getCurrentGasPriceAndBlock(provider);
        const ethPrice = await getCurrentEthPrice();
        const formattedGasPrice = parseFloat(gasPrice).toFixed(4);

        const messageText = `*Gas:* ${formattedGasPrice} Gwei  ▰  *Block:* ${blockNumber}  ▰  *ETH ⟠:* $${ethPrice} \n\n` +
                            `🟨  *Blastie bot*  🟨\n\n` +
                            `═══ *Wallet address* ═══ \n\n\`${user.walletAddress}\`\n\n` +
                            `*ETH balance:* \`⟠${parseFloat(ethBalance).toFixed(3)} ETH \`\n` +
                            `*Point Earned:* \`${user.points} points\`\n\n`+
                            `[Tornado](https://t.me/TornadoBlastBot)`;
                            
                            

        bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            disable_web_page_preview: true,
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Create tokens 👨‍🍳', callback_data: 'create_tokens' },
                    { text: 'Manage tokens 🔧', callback_data: 'manage_tokens' }],
                    [{ text: 'Settings ⚙️', callback_data: 'settings' }]
                ],
            }
        });
    }

    if (action.startsWith('download_code_')) {
        const tokenIndex = parseInt(action.split('_')[2]);
    
        try {
            const user = await db.collection('users').findOne({ userId });
            if (user && user.tokenCreated && user.tokenCreated.length > tokenIndex) {
                const token = user.tokenCreated[tokenIndex];
                const contractSource = token.contractSource;
    
                if (contractSource) {
                    const tempDir = os.tmpdir();
                    const filename = 'contract.txt';
                    const filePath = path.join(tempDir, filename);
                    fs.writeFileSync(filePath, contractSource);
    
                    console.log(`File path: ${filePath}`);
                    console.log(`File exists: ${fs.existsSync(filePath)}`);
    
                    // Create FormData and append the file
                    const formData = new FormData();
                    formData.append('chat_id', chatId);
                    formData.append('document', fs.createReadStream(filePath), filename);
    
                    // Send the file using FormData
                    const requestOptions = {
                        method: 'POST',
                        headers: formData.getHeaders(),
                        body: formData,
                    };
                    const url = `https://api.telegram.org/bot${telegramBotToken}/sendDocument`;
                    const response = await fetch(url, requestOptions);
                    const responseData = await response.json();
                    console.log(responseData);
    
                    // Cleanup: Delete the temporary file
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            console.error('Error deleting temporary file:', err);
                        }
                    });
    
                } else {
                    bot.sendMessage(chatId, "Contract source code not available.");
                }
            } else {
                bot.sendMessage(chatId, "Token not found.");
            }
        } catch (error) {
            console.error('Error sending contract source:', error);
            bot.sendMessage(chatId, "An error occurred while fetching the contract source code.");
        }
    }


});




bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const userId = msg.from.id;
    const chatId = msg.chat.id;

    const sessionData = await redisClient.get(`session:${userId}`);


        
    if (!sessionData) {
            console.log("No session found for userId:", userId);
            // Optionally, initialize a session here if it should exist
            await initializeUserSession(userId);
            return;
    }

    const userSession = JSON.parse(sessionData);
    

    

    if (userSession && userSession.currentState === 'awaiting_token_name') {
        userSession.name = msg.text;
        userSession.currentState = null; // Reset the state
        
        
        if (userSession.namePromptMessageId) {
            await bot.deleteMessage(chatId, userSession.namePromptMessageId);
            delete userSession.namePromptMessageId;
            
        }

        await bot.deleteMessage(chatId, msg.message_id);

        // Save the updated session after all changes are made
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));

        console.log("userSession after user provided token name", userSession);

        await showStandardTokenParameters(chatId, userId);
    }


    if (userSession && userSession.currentState === 'awaiting_marketing_wallet') {
        userSession.MarketingWallet = msg.text;
        userSession.currentState = null; // Reset the state
        
        
        if (userSession.marketingWalletPromptMessageId) {
            await bot.deleteMessage(chatId, userSession.marketingWalletPromptMessageId);
            delete userSession.marketingWalletPromptMessageId;
            
        }

        await bot.deleteMessage(chatId, msg.message_id);

        // Save the updated session after all changes are made
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));

        console.log("userSession after user provided token name", userSession);

        await showLimitParameters(chatId, userId);
    }

    


    if (userSession && userSession.currentState === 'awaiting_token_name_custom') {
        userSession.name = msg.text;
        userSession.currentState = null; // Reset the state
        
        
        if (userSession.namePromptcustomMessageId) {
            await bot.deleteMessage(chatId, userSession.namePromptcustomMessageId);
            delete userSession.namePromptcustomMessageId;
            
        }

        await bot.deleteMessage(chatId, msg.message_id);

        // Save the updated session after all changes are made
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));

        console.log("userSession after user provided token name", userSession);

        await showCustomTokenParameters(chatId, userId);
    }


    


    if (userSession && userSession.currentState === 'awaiting_token_name_ERC404') {
        userSession.name = msg.text;
        userSession.currentState = null; // Reset the state
        
        
        if (userSession.nameERC404PromptMessageId) {
            await bot.deleteMessage(chatId, userSession.nameERC404PromptMessageId);
            delete userSession.nameERC404PromptMessageId;
            
        }

        await bot.deleteMessage(chatId, msg.message_id);

        // Save the updated session after all changes are made
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));

        console.log("userSession after user provided token name", userSession);

        await showERC404TokenParameters(chatId, userId);
    }

    if (userSession && userSession.currentState === 'awaiting_token_symbol') {
        console.log("Received symbol response from user:", userId);
        userSession.symbol = msg.text;
        userSession.currentState = null; // Reset the state
        

        if (userSession.symbolPromptMessageId) {
            await bot.deleteMessage(chatId, userSession.symbolPromptMessageId);
            delete userSession.symbolPromptMessageId;
        }

        await bot.deleteMessage(chatId, msg.message_id);

        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));

        console.log("userSession after user provided token symbol", userSession);


        await showStandardTokenParameters(chatId, userId);
    }


    if (userSession && userSession.currentState === 'awaiting_token_symbol_custom') {
        console.log("Received symbol response from user:", userId);
        userSession.symbol = msg.text;
        userSession.currentState = null; // Reset the state
        

        if (userSession.symbolPromptcustomMessageId) {
            await bot.deleteMessage(chatId, userSession.symbolPromptcustomMessageId);
            delete userSession.symbolPromptcustomMessageId;
        }

        await bot.deleteMessage(chatId, msg.message_id);

        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));

        console.log("userSession after user provided token symbol", userSession);


        await showCustomTokenParameters(chatId, userId);
    }





    if (userSession && userSession.currentState === 'awaiting_token_symbol_ERC404') {
        console.log("Received symbol response from user:", userId);
        userSession.symbol = msg.text;
        userSession.currentState = null; // Reset the state
        

        if (userSession.symbolERC404PromptMessageId) {
            await bot.deleteMessage(chatId, userSession.symbolERC404PromptMessageId);
            delete userSession.symbolERC404PromptMessageId;
        }

        await bot.deleteMessage(chatId, msg.message_id);

        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));

        console.log("userSession after user provided token symbol", userSession);


        await showERC404TokenParameters(chatId, userId);
    }





    if (userSession && userSession.currentState === 'awaiting_token_supply') {
        userSession.supply = msg.text;
        userSession.currentState = null; // Reset the state

        if (userSession.supplyPromptMessageId) {
            await bot.deleteMessage(chatId, userSession.supplyPromptMessageId);
            delete userSession.supplyPromptMessageId;
        }

        await bot.deleteMessage(chatId, msg.message_id);
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        await showStandardTokenParameters(chatId, userId);
    }


    if (userSession && userSession.currentState === 'awaiting_token_supply_custom') {
        userSession.supply = msg.text;
        userSession.currentState = null; // Reset the state

        if (userSession.supplyPromptcustomMessageId) {
            await bot.deleteMessage(chatId, userSession.supplyPromptcustomMessageId);
            delete userSession.supplyPromptcustomMessageId;
        }

        await bot.deleteMessage(chatId, msg.message_id);
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        await showCustomTokenParameters(chatId, userId);
    }

    

    if (userSession && userSession.currentState === 'awaiting_token_supply_ERC404') {
        userSession.supply = msg.text;
        userSession.currentState = null; // Reset the state

        if (userSession.supplyERC404PromptMessageId) {
            await bot.deleteMessage(chatId, userSession.supplyERC404PromptMessageId);
            delete userSession.supplyERC404PromptMessageId;
        }

        await bot.deleteMessage(chatId, msg.message_id);
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        await showERC404TokenParameters(chatId, userId);
    }

    

    if (userSession && userSession.currentState === 'awaiting_baseuri') {
        userSession.baseuri = msg.text;
        userSession.currentState = null; // Reset the state

        if (userSession.baseuriPromptMessageId) {
            await bot.deleteMessage(chatId, userSession.baseuriPromptMessageId);
            delete userSession.baseuriPromptMessageId;
        }

        await bot.deleteMessage(chatId, msg.message_id);
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
        await showERC404TokenParameters(chatId, userId);
    }


    if (userSession && userSession.currentState) {
        let fieldType;
        let isBuyTax = false;
        let isCustomToken = false;
        let isSellTax = false;
        let isLimit = false;

    
        // Determine the type of the current state
        if (userSession.currentState.startsWith('set_buy_')) {
            fieldType = userSession.currentState.split('_')[2];
            isBuyTax = true;

        } else if (userSession.currentState.startsWith('set_custom_')) {
            fieldType = userSession.currentState.split('_')[2];
            isCustomToken = true;


        } else if (userSession.currentState.startsWith('set_max_')) {
                console.log("yes it's set_max_" );
                fieldType = userSession.currentState.split('_')[2];
                console.log("fieldType", fieldType);
                isLimit = true;   


        } else if (userSession.currentState.startsWith('set_sell_')) {
            fieldType = userSession.currentState.split('_')[2];
            isSellTax = true;
        
        } else {
            fieldType = userSession.currentState.split('_')[1];
        };
    
        // Update the session based on the type
        if (isBuyTax) {
            userSession.buyTax[fieldType] = msg.text;
        } else if (isCustomToken) {
            userSession[fieldType] = msg.text;
        
        } else if (isSellTax) {
            userSession.sellTax[fieldType] = msg.text;

        } else if (isLimit) {
            console.log("yes it's isLimit", isLimit);
            userSession.txnLimit[fieldType] = msg.text;

        } else {
            // Handle other cases
            userSession[fieldType] = msg.text;
        };
    
        userSession.currentState = null; // Reset the state
    
        // Delete the appropriate prompt message
        if (isBuyTax && userSession.buyTaxPromptMessageId) {
            await bot.deleteMessage(chatId, userSession.buyTaxPromptMessageId);
            delete userSession.buyTaxPromptMessageId;

        } else if (isCustomToken && userSession.socialPromptcustomMessageId) {
            await bot.deleteMessage(chatId, userSession.socialPromptcustomMessageId);
            delete userSession.socialPromptcustomMessageId;

        } else if (isSellTax && userSession.sellTaxPromptMessageId) {
            await bot.deleteMessage(chatId, userSession.sellTaxPromptMessageId);
            delete userSession.sellTaxPromptMessageId;
        
        
        } else if (isLimit && userSession.maxLimitPromptMessageId) {
            console.log("userSession.maxLimitPromptMessageId", userSession.maxLimitPromptMessageId);
            await bot.deleteMessage(chatId, userSession.maxLimitPromptMessageId);
            delete userSession.maxLimitPromptMessageId;

        
       }    else if (!isCustomToken && userSession.socialPromptMessageId) {
            await bot.deleteMessage(chatId, userSession.socialPromptMessageId);
            delete userSession.socialPromptMessageId;
        };
    
        await bot.deleteMessage(chatId, msg.message_id);
        await redisClient.set(`session:${userId}`, JSON.stringify(userSession));
    
        // Display the correct interface based on the input type
        if (isBuyTax) {

            await showBuyTaxParameters(chatId, userId);
            
        } else if (isSellTax) {

            await showSellTaxParameters(chatId, userId);

        }  else if (isLimit) {

            await showLimitParameters(chatId, userId);

        }
        
        else if (isCustomToken) {

            await showSocialsCustomParameters(chatId, userId);

        } else {
            
            await showSocialsParameters(chatId, userId);
        }

    }

});

}).catch(err => {
    console.error('Failed to connect to Redis:', err);
});

////////////// MANAGE TOKENS ///////////////

// This function is triggered when 'Manage tokens' is clicked
async function handleManageTokens(chatId, userId) {
    // Fetch user data from the database
    const user = await db.collection('users').findOne({ userId });
    if (!user || !user.tokenCreated || user.tokenCreated.length === 0) {
        return bot.sendMessage(chatId, "You have not created any tokens yet.");
    }

    const tokenButtons = user.tokenCreated.map((token, index) => {
        return [{ text: token.name, callback_data: `token_details_${index}` }];
    });

    bot.sendMessage(chatId, `*Select a token to manage.*\n\n`+
    `ℹ️ Obtain the token information and download the source code. Click on the token name to view more details.\n\n`, {
        parse_mode:"Markdown",
        reply_markup: {
            inline_keyboard: tokenButtons
        }
    });
}


async function displayTokenDetails(chatId, userId, tokenIndex) {
    const user = await db.collection('users').findOne({ userId });
    if (!user || !user.tokenCreated || user.tokenCreated.length <= tokenIndex) {
        return bot.sendMessage(chatId, "Token not found.");
    }

    const token = user.tokenCreated[tokenIndex];
    let messageText = `Token Details:\n\n` +
                      `Name: \`${token.name}\`\n\n` +
                      `Symbol: \`${token.symbol}\`\n\n` +
                      `Chain: \`${token.chain}\`\n\n` +
                      `Supply: \`${token.supply}\`\n\n` +
                      `Website: \`${token.website}\`\n\n` +
                      `Telegram: \`${token.telegram}\`\n\n` +
                      `Twitter: \`${token.twitter}\`\n\n` +
                      `Contract Address: \n\n\`${token.contractAddress}\`\n\n`+
                      `[View on Blastscan](https://testnet.blastscan.io/address/${token.contractAddress})`;;

                      bot.sendMessage(chatId, messageText, {
                        parse_mode: "Markdown",
                        disable_web_page_preview: true,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: 'Download source code', callback_data: `download_code_${tokenIndex}` }],
                                [{ text: 'Home 🏠', callback_data: 'return_main_menu' }]
                            ]
                        }
                    });
}
// Example usage in the bot callback



///////////////////// DEPLOYMENT ///////////////////


async function compileContract(name, userId) {
    const contractFileName = `StandardToken${name}${userId}.sol`;
    const contractsDir = path.join(__dirname, 'contracts');
    const contractFilePath = path.join(contractsDir, contractFileName);
    const contractSrc = fs.readFileSync(contractFilePath, 'utf8');

    // Configure input for compilation
    const input = {
        language: 'Solidity',
        sources: {
            [contractFileName]: {
                content: contractSrc,
            },
        },
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            },
            metadata: {
                useLiteralContent: true
            },
            outputSelection: {
                '*': {
                    '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'metadata']
                }
            }
        }
    };

    // Compile the contract
    const output = JSON.parse(solc.compile(JSON.stringify(input)));

    // Check for and handle errors
    if (output.errors) {
        output.errors.forEach((err) => {
            console.error(err.formattedMessage);
        });
        throw new Error('Compilation failed');
    }

    // Extract compiled contract
    const contractName = `StandardToken${name}${userId}`;
    const compiledContract = output.contracts[contractFileName][contractName];
    const { abi, evm } = compiledContract;

    console.log("ABI:", abi);
    console.log("Bytecode:", evm.bytecode.object);

    return { abi, bytecode: evm.bytecode.object };
}


function generateUserHardhatConfig(userId, userDirPath) {
    const hardhatConfigContent = `
    require("@nomicfoundation/hardhat-verify");
        const path = require("path");
        const PRIVATE_KEY =process.env.PRIVATE_KEY;

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
            paths: {
                artifacts: "./artifacts",
                cache: "./cache",
                sources: "./contracts",
            },
        };
    `;

    const hardhatConfigPath = path.join(userDirPath, 'hardhat.config.js');
    fs.writeFileSync(hardhatConfigPath, hardhatConfigContent);
    console.log("Custom hardhat config file has been generated successfully");
}


function execShellCommand(cmd, cwd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { cwd }, (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                return reject(error);
            }
            if (stderr) {
                console.error(`stderr: ${stderr}`);
                return reject(stderr);
            }
            resolve(stdout);
        });
    });
}



async function deployContract(chain, name, symbol, supply, website, telegram, twitter, userId) {

    const userDirName = `User_${userId}`;
    const userDirPath = path.join(__dirname, userDirName);
    const modifiedsymbol = symbol.replace(/\s+/g, '');

    // Create user-specific directory and contracts folder
    const contractsFolderPath = path.join(userDirPath, 'contracts');
    if (!fs.existsSync(contractsFolderPath)) {
        fs.mkdirSync(contractsFolderPath, { recursive: true });
    }



    // //     //generate Contract file
    const contractSource = getContractSource(userId, name, modifiedsymbol, supply, website, telegram, twitter);
    const contractFileName = `StandardToken${userId}.sol`;
    const contractFilePath = path.join(contractsFolderPath, contractFileName);
    console.log("Contract file path created:", contractFilePath);
    fs.writeFileSync(contractFilePath, contractSource);
    console.log("Contract file saved successfully");
        
    // Generate custom hardhat.config.js
    generateUserHardhatConfig(userId, userDirPath);

    const originalDir = process.cwd();
    console.log("originalDir", originalDir);
    process.chdir(userDirPath);
    const currentDir = process.cwd();
    console.log("currentDir", currentDir);




    // 5. Compile the Contract
    const compileOutput = await execShellCommand(`npx hardhat compile --config ${path.join(userDirPath, 'hardhat.config.js')}`, userDirPath);
    console.log(compileOutput);
    

    //const { abi, bytecode } = await compileContract(name, userId);


    const user = await db.collection('users').findOne({ userId });
    const encryptedPrivateKey = user.encryptedPrivateKey;

    // //     // Decrypt the user's private key
    const privateKey = decryptPrivateKey(encryptedPrivateKey, process.env.ENCRYPTION_KEY);
    const provider = new ethers.providers.JsonRpcProvider(`https://rpc.ankr.com/blast_testnet_sepolia/${process.env.ANKRKEY}`);
    const wallet = new ethers.Wallet(privateKey, provider);

    // //      // Check for sufficient balance
    const balance = await provider.getBalance(wallet.address);
    if (balance.lt(ethers.utils.parseEther("0.03"))) { // Assuming 0.01 ETH is the minimum required balance
    throw new Error("Insufficient balance to deploy the contract. Please add a minimum of 0.03 ETH to your wallet.");
        }

    // Path to the contract artifact
    const artifactPath = path.join(userDirPath, 'artifacts', 'contracts', contractFileName, contractFileName.replace('.sol', '.json'));
    
    // Load the contract artifact
    const contractArtifact = require(artifactPath);

    const contractFactory = new ethers.ContractFactory(
        contractArtifact.abi,
        contractArtifact.bytecode,
        wallet
    );
    // const contractFactory = new ethers.ContractFactory(
    //     abi,
    //     bytecode,
    //     wallet
    // );

    try {
        const options = { gasLimit: 10000000 };
        const contract = await contractFactory.deploy(options);
        await contract.deployed();
        console.log(`Contract deployed at: ${contract.address}`);


   

        setTimeout(() => {
            try {
                const verifyCommand = `npx hardhat verify --network blast_sepolia ${contract.address}`;

                const execOptions = {
                    cwd: userDirPath // User-specific directory path
                };

                exec(verifyCommand, execOptions, async(error, stdout, stderr) => {
                    if (error) {
                        console.error(`Error during contract verification: ${error.message}`);
                        return;
                    }
                    if (stderr) {
                        console.error(`Verification stderr: ${stderr}`);
                        return;
                    }
                    console.log(`Contract verified at: ${contract.address}`);
                    console.log(stdout);
                    
                    // deleteContractFile(contractFilePath);

                   
                    // const artifactsPath = path.join(__dirname, 'artifacts');
                    // const cachePath = path.join(__dirname, 'cache');
                    // fs.rmSync(artifactsPath, { recursive: true, force: true });
                    // fs.rmSync(cachePath, { recursive: true, force: true });

                    fs.rmSync(userDirPath, { recursive: true, force: true });
                    console.log(`User-specific directory deleted successfully.`);
                    
                });
            } catch (verifyError) {
                process.chdir(originalDir);
                console.error('Error during contract verification:', verifyError);
            }
    
        }, 20000); // 10000 milliseconds = 10 seconds
    

        const timestamp = new Date().getTime(); 

        // Update the database with the new contract information
        await db.collection('users').updateOne(
            { userId },
            {
                $push: {
                    tokenCreated: {
                        chain,
                        name,
                        symbol,
                        supply,
                        website,
                        telegram,
                        twitter,
                        contractAddress: contract.address,
                        contractSource: contractSource, // Include the contract source here
                        timestamp: timestamp
                    }
                },
                $inc: { points: 1000 }
            }
        );


        return contract.address;

    } catch (error) {
        if (error.message.includes('insufficient funds')) {
            console.error('Insufficient funds for gas:', error);
            throw new Error('Insufficient funds for gas. Please add more ETH to your wallet.');
            
        }
        console.error('Error deploying contract:', error);
        throw error; 
    }
}




async function deployContractCustom(chain,
    name, 
    symbol, 
    supply, 
    reflectionFeeOnBuy, 
    reflectionFeeOnSell,
    liquidityFeeOnBuy, 
    liquidityFeeOnSell,
    marketingFeeOnBuy, 
    marketingFeeOnSell, 
    burnFeeOnBuy,
    burnFeeOnSell,
    marketingWalletAddress,
    maxTransactionAmountBuyPercentage,
    maxTransactionAmountSellPercentage,
    maxWalletAmountPercentage,
    website,twitter, telegram, description,  userId) {




    const modifiedsymbol = symbol.replace(/\s+/g, '');
    const userDirName = `User_${userId}`;
    const userDirPath = path.join(__dirname, userDirName);
    

    // Create user-specific directory and contracts folder
    const contractsFolderPath = path.join(userDirPath, 'contracts');
    if (!fs.existsSync(contractsFolderPath)) {
        fs.mkdirSync(contractsFolderPath, { recursive: true });
    }


    // //     //generate Contract file
    const contractSource = getCustomContractSource(chain,
        name,
        modifiedsymbol,
        supply,
        reflectionFeeOnBuy,
        reflectionFeeOnSell,
        liquidityFeeOnBuy,
        liquidityFeeOnSell,
        marketingFeeOnBuy,
        marketingFeeOnSell,
        burnFeeOnBuy,
        burnFeeOnSell,
        marketingWalletAddress,
        maxTransactionAmountBuyPercentage,
        maxTransactionAmountSellPercentage,
        maxWalletAmountPercentage,
        website,
        twitter,
        telegram,
        description,
        userId);
    const contractFileName = `StandardToken${userId}.sol`;
    const contractFilePath = path.join(contractsFolderPath, contractFileName);
    console.log("Contract file path created:", contractFilePath);
    fs.writeFileSync(contractFilePath, contractSource);
    console.log("Contract file saved successfully");
        
    // Generate custom hardhat.config.js
    generateUserHardhatConfig(userId, userDirPath);

    const originalDir = process.cwd();
    console.log("originalDir", originalDir);
    process.chdir(userDirPath);
    const currentDir = process.cwd();
    console.log("currentDir", currentDir);




    // 5. Compile the Contract
    const compileOutput = await execShellCommand(`npx hardhat compile --config ${path.join(userDirPath, 'hardhat.config.js')}`, userDirPath);
    console.log(compileOutput);
    

    //const { abi, bytecode } = await compileContract(name, userId);


    const user = await db.collection('users').findOne({ userId });
    const encryptedPrivateKey = user.encryptedPrivateKey;

    // //     // Decrypt the user's private key
    const privateKey = decryptPrivateKey(encryptedPrivateKey, process.env.ENCRYPTION_KEY);
    const provider = new ethers.providers.JsonRpcProvider(`https://rpc.ankr.com/blast_testnet_sepolia/${process.env.ANKRKEY}`);
    const wallet = new ethers.Wallet(privateKey, provider);

    // //      // Check for sufficient balance
    const balance = await provider.getBalance(wallet.address);
    if (balance.lt(ethers.utils.parseEther("0.03"))) { // Assuming 0.01 ETH is the minimum required balance
    throw new Error("Insufficient balance to deploy the contract. Please add a minimum of 0.03 ETH to your wallet.");
        }

    // Path to the contract artifact
    const artifactPath = path.join(userDirPath, 'artifacts', 'contracts', contractFileName, contractFileName.replace('.sol', '.json'));
    
    // Load the contract artifact
    const contractArtifact = require(artifactPath);

    const contractFactory = new ethers.ContractFactory(
        contractArtifact.abi,
        contractArtifact.bytecode,
        wallet
    );
    // const contractFactory = new ethers.ContractFactory(
    //     abi,
    //     bytecode,
    //     wallet
    // );

    try {
        const options = { gasLimit: 10000000 };
        const contract = await contractFactory.deploy(options);
        await contract.deployed();
        console.log(`Contract deployed at: ${contract.address}`);


   

        setTimeout(() => {
            try {
                const verifyCommand = `npx hardhat verify --network blast_sepolia ${contract.address}`;

                const execOptions = {
                    cwd: userDirPath // User-specific directory path
                };

                exec(verifyCommand, execOptions, async(error, stdout, stderr) => {
                    if (error) {
                        console.error(`Error during contract verification: ${error.message}`);
                        return;
                    }
                    if (stderr) {
                        console.error(`Verification stderr: ${stderr}`);
                        return;
                    }
                    console.log(`Contract verified at: ${contract.address}`);
                    console.log(stdout);
                    // deleteContractFile(contractFilePath);

                   
                    // const artifactsPath = path.join(__dirname, 'artifacts');
                    // const cachePath = path.join(__dirname, 'cache');
                    // fs.rmSync(artifactsPath, { recursive: true, force: true });
                    // fs.rmSync(cachePath, { recursive: true, force: true });

                    fs.rmSync(userDirPath, { recursive: true, force: true });
                    console.log(`User-specific directory deleted successfully.`);
                    
                });
            } catch (verifyError) {
                fs.rmSync(userDirPath, { recursive: true, force: true });
                process.chdir(originalDir);
                console.error('Error during contract verification:', verifyError);
            }
    
        }, 20000); // 10000 milliseconds = 10 seconds
    

        const timestamp = new Date().getTime(); 

        // Update the database with the new contract information
        await db.collection('users').updateOne(
            { userId },
            {
                $push: {
                    tokenCreated: {
                        chain,
                        name,
                        symbol,
                        supply,
                        website,
                        telegram,
                        twitter,
                        contractAddress: contract.address,
                        contractSource: contractSource, // Include the contract source here
                        timestamp: timestamp
                    }
                },
                $inc: { points: 1000 }
            }
        );


        return contract.address;

    } catch (error) {
        if (error.message.includes('insufficient funds')) {
            console.error('Insufficient funds for gas:', error);
            throw new Error('Insufficient funds for gas. Please add more ETH to your wallet.');
            
        }
        console.error('Error deploying contract:', error);
        throw error; 
    }
}


async function deployContractERC404(chain, name, symbol, supply, baseuri, userId) {

    const userDirName = `User_${userId}`;
    const userDirPath = path.join(__dirname, userDirName);
    const modifiedsymbol = symbol.replace(/\s+/g, '');

    // Create user-specific directory and contracts folder
    const contractsFolderPath = path.join(userDirPath, 'contracts');
    if (!fs.existsSync(contractsFolderPath)) {
        fs.mkdirSync(contractsFolderPath, { recursive: true });
    }

    console.log("userId:", userId);
    console.log("name:", name);
    console.log("modifiedsymbol:", modifiedsymbol);
    console.log("supply:", supply);
    console.log("baseuri:", baseuri);



    // //     //generate Contract file
    const contractSource = get404ContractSource(userId, name, modifiedsymbol, supply, baseuri);
    const contractFileName = `ERC404Token${userId}.sol`;
    const contractFilePath = path.join(contractsFolderPath, contractFileName);
    console.log("Contract file path created:", contractFilePath);
    console.log("contractSource", contractSource);
    fs.writeFileSync(contractFilePath, contractSource);
    console.log("Contract file saved successfully");
        
    // Generate custom hardhat.config.js
    generateUserHardhatConfig(userId, userDirPath);

    const originalDir = process.cwd();
    console.log("originalDir", originalDir);
    process.chdir(userDirPath);
    const currentDir = process.cwd();
    console.log("currentDir", currentDir);




    // 5. Compile the Contract
    const compileOutput = await execShellCommand(`npx hardhat compile --config ${path.join(userDirPath, 'hardhat.config.js')}`, userDirPath);
    console.log(compileOutput);
    

    //const { abi, bytecode } = await compileContract(name, userId);


    const user = await db.collection('users').findOne({ userId });
    const encryptedPrivateKey = user.encryptedPrivateKey;

    // //     // Decrypt the user's private key
    const privateKey = decryptPrivateKey(encryptedPrivateKey, process.env.ENCRYPTION_KEY);
    const provider = new ethers.providers.JsonRpcProvider(`https://rpc.ankr.com/blast_testnet_sepolia/${process.env.ANKRKEY}`);
    const wallet = new ethers.Wallet(privateKey, provider);

    // //      // Check for sufficient balance
    const balance = await provider.getBalance(wallet.address);
    if (balance.lt(ethers.utils.parseEther("0.03"))) { // Assuming 0.01 ETH is the minimum required balance
    throw new Error("Insufficient balance to deploy the contract. Please add a minimum of 0.03 ETH to your wallet.");
        }

    // Path to the contract artifact
    const artifactPath = path.join(userDirPath, 'artifacts', 'contracts', contractFileName, contractFileName.replace('.sol', '.json'));
    
    // Load the contract artifact
    const contractArtifact = require(artifactPath);

    const contractFactory = new ethers.ContractFactory(
        contractArtifact.abi,
        contractArtifact.bytecode,
        wallet
    );
    // const contractFactory = new ethers.ContractFactory(
    //     abi,
    //     bytecode,
    //     wallet
    // );

    try {
        const options = { gasLimit: 10000000 };
        const contract = await contractFactory.deploy(options);
        await contract.deployed();
        console.log(`Contract deployed at: ${contract.address}`);


   

        setTimeout(() => {
            try {
                const verifyCommand = `npx hardhat verify --network blast_sepolia ${contract.address}`;

                const execOptions = {
                    cwd: userDirPath // User-specific directory path
                };

                exec(verifyCommand, execOptions, async(error, stdout, stderr) => {
                    if (error) {
                        console.error(`Error during contract verification: ${error.message}`);
                        return;
                    }
                    if (stderr) {
                        console.error(`Verification stderr: ${stderr}`);
                        return;
                    }
                    console.log(`Contract verified at: ${contract.address}`);
                    console.log(stdout);
                    

                    fs.rmSync(userDirPath, { recursive: true, force: true });
                    console.log(`User-specific directory deleted successfully.`);
                    
                });
            } catch (verifyError) {
                process.chdir(originalDir);
                console.error('Error during contract verification:', verifyError);
            }
    
        }, 20000); 
    

        const timestamp = new Date().getTime(); 

        // Update the database with the new contract information
        await db.collection('users').updateOne(
            { userId },
            {
                $push: {
                    tokenCreated: {
                        chain,
                        name,
                        modifiedsymbol,
                        supply,
                        baseuri,
                        contractAddress: contract.address,
                        contractSource: contractSource, // Include the contract source here
                        timestamp: timestamp
                    }
                },
                $inc: { points: 1000 }
            }
        );


        return contract.address;

    } catch (error) {
        if (error.message.includes('insufficient funds')) {
            console.error('Insufficient funds for gas:', error);
            throw new Error('Insufficient funds for gas. Please add more ETH to your wallet.');
            
        }
        console.error('Error deploying contract:', error);
        throw error; 
    }
}




function ensureDirectoryExistence(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

const rimrafOptions = {
    // Add any specific options you need here. For example:
    glob: false, // If you're not using glob patterns
    maxRetries: 10, // Maximum retry attempts
    backoff: 1.2, // Backoff factor for retries
    // ... any other options based on your requirement
};

function deleteDirectory(directoryPath) {
    return new Promise((resolve, reject) => {
        rimraf(directoryPath, rimrafOptions, (error) => {
            if (error) {
                console.error(`Error deleting ${directoryPath}:`, error);
                reject(error);
            } else {
                console.log(`Directory ${directoryPath} deleted successfully.`);
                resolve();
            }
        });
    });
}
function deleteContractFile(filePath) {
    fs.unlink(filePath, (err) => {
        if (err) {
            console.error(`Error deleting contract file ${filePath}:`, err);
        } else {
            console.log(`Contract file ${filePath} deleted successfully.`);
        }
    });
}

async function cleanupDirectories(userId) {
    const baseArtifactsPath = path.join(__dirname, 'artifacts');
    const baseCachePath = path.join(__dirname, 'cache');
    const userArtifactsPath = path.join(baseArtifactsPath, `user_${userId}`);
    const userCachePath = path.join(baseCachePath, `user_${userId}`);

    // Delete user-specific directories
    await deleteDirectory(userArtifactsPath);
    await deleteDirectory(userCachePath);

    // Clean up remaining files/directories in base artifacts and cache folders
    await cleanBaseDirectory(baseArtifactsPath);
    await cleanBaseDirectory(baseCachePath);
}

async function cleanBaseDirectory(directoryPath) {
    if (fs.existsSync(directoryPath)) {
        const filesAndDirs = fs.readdirSync(directoryPath);
        for (const fileOrDir of filesAndDirs) {
            const fullPath = path.join(directoryPath, fileOrDir);
            if (fs.lstatSync(fullPath).isDirectory()) {
                await deleteDirectory(fullPath);
            } else {
                fs.unlinkSync(fullPath);
                console.log(`File ${fullPath} deleted.`);
            }
        }
    } else {
        console.log(`Directory ${directoryPath} does not exist.`);
    }
}



function executeCommand(command) {
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error: ${error.message}`);
          return reject(error);
        }
        if (stderr) {
          console.error(`Stderr: ${stderr}`);
          return reject(new Error(stderr));
        }
        console.log(`Stdout: ${stdout}`);
        resolve(stdout);
      });
    });
  }




function generateHardhatConfig(configPath, userDirPath) {
    const hardhatConfigTemplate = `
require("@nomicfoundation/hardhat-verify");
const path = require("path");

const PRIVATE_KEY = process.env.PRIVATE_KEY;

module.exports = {
  solidity: {
    version: "0.8.23", // Specify compiler version
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
  paths: {
    sources: path.join('${userDirPath}', 'contracts'),
    artifacts: path.join('${userDirPath}', 'artifacts'),
    cache: path.join('${userDirPath}', 'cache'),
    tests: path.join('${userDirPath}', 'test')
  },
  // Add other Hardhat configurations if necessary
};
`;

    fs.writeFileSync(configPath, hardhatConfigTemplate);
}


// Connect to MongoDB and Start the Bot
connectMongoDB().then(() => {
    console.log('Bot is running');
});

// Error Handling
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    process.exit(1);
});
