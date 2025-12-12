
// ================================================================
// HONEYPOT DETECTION
// ================================================================
// Checks if a token is a honeypot (can buy but cannot sell)
// Also detects buy/sell taxes and other security issues
// ================================================================

const https = require('https');

// Security API
const SECURITY_API = 'https://api.gopluslabs.io/api/v1/token_security';

// Chain IDs
const CHAIN_IDS = {
    ethereum: '1',
    bsc: '56',
    polygon: '137',
    arbitrum: '42161',
    base: '8453'
};

// ================================================================
// HELPER FUNCTIONS
// ================================================================

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(new Error('Failed to parse response'));
                }
            });
        }).on('error', reject);
    });
}

function toPercent(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = parseFloat(value);
    return isNaN(num) ? null : (num * 100).toFixed(2);
}

function toBool(value) {
    return value === '1' || value === 1 || value === true;
}

// ================================================================
// MAIN FUNCTION
// ================================================================

async function checkHoneypot(tokenAddress, chain = 'ethereum') {
    const chainId = CHAIN_IDS[chain] || '1';
    const url = `${SECURITY_API}/${chainId}?contract_addresses=${tokenAddress.toLowerCase()}`;
    
    console.log('========================================');
    console.log('HONEYPOT DETECTION');
    console.log('========================================');
    console.log(`Token: ${tokenAddress}`);
    console.log(`Chain: ${chain} (ID: ${chainId})`);
    console.log('');
    console.log('Fetching security data...');
    
    try {
        const response = await fetchJSON(url);
        
        if (!response || response.code !== 1) {
            console.log('Error: Failed to fetch security data');
            console.log('Response:', JSON.stringify(response, null, 2));
            return {
                success: false,
                error: 'API request failed',
                risk: 'UNKNOWN'
            };
        }
        
        const tokenData = response.result[tokenAddress.toLowerCase()];
        
        if (!tokenData) {
            console.log('Error: Token not found in security database');
            console.log('This could mean:');
            console.log('  - Token is too new');
            console.log('  - Token has no trading activity');
            console.log('  - Invalid token address');
            return {
                success: false,
                error: 'Token not found',
                risk: 'UNKNOWN'
            };
        }
        
        // Extract key data
        const result = {
            success: true,
            
            // Basic info
            tokenName: tokenData.token_name || 'Unknown',
            tokenSymbol: tokenData.token_symbol || 'Unknown',
            totalSupply: tokenData.total_supply || '0',
            holderCount: tokenData.holder_count || '0',
            
            // Honeypot detection
            isHoneypot: toBool(tokenData.is_honeypot),
            honeypotReason: tokenData.honeypot_with_same_creator || null,
            
            // Trading taxes
            buyTax: toPercent(tokenData.buy_tax),
            sellTax: toPercent(tokenData.sell_tax),
            
            // Ownership risks
            isOpenSource: toBool(tokenData.is_open_source),
            isProxy: toBool(tokenData.is_proxy),
            isMintable: toBool(tokenData.is_mintable),
            canTakeBackOwnership: toBool(tokenData.can_take_back_ownership),
            ownerCanChangeBalance: toBool(tokenData.owner_change_balance),
            hiddenOwner: toBool(tokenData.hidden_owner),
            
            // Trading restrictions
            cannotBuy: toBool(tokenData.cannot_buy),
            cannotSellAll: toBool(tokenData.cannot_sell_all),
            tradingCooldown: toBool(tokenData.trading_cooldown),
            transferPausable: toBool(tokenData.transfer_pausable),
            isBlacklisted: toBool(tokenData.is_blacklisted),
            isWhitelisted: toBool(tokenData.is_whitelisted),
            isAntiWhale: toBool(tokenData.is_anti_whale),
            antiWhaleModifiable: toBool(tokenData.anti_whale_modifiable),
            slippageModifiable: toBool(tokenData.slippage_modifiable),
            personalSlippageModifiable: toBool(tokenData.personal_slippage_modifiable),
            
            // External checks
            isInDex: toBool(tokenData.is_in_dex),
            dexInfo: tokenData.dex || [],
            
            // Trust signals
            isTrueToken: toBool(tokenData.is_true_token),
            isAirdropScam: toBool(tokenData.is_airdrop_scam),
            
            // LP info (liquidity lock/burn data)
            lpHolderCount: tokenData.lp_holder_count || '0',
            lpTotalSupplyPercent: toPercent(tokenData.lp_total_supply),
            lpHolders: tokenData.lp_holders || [],
            
            // Creator info  
            creatorAddress: tokenData.creator_address || null,
            creatorBalance: tokenData.creator_percent ? toPercent(tokenData.creator_percent) : null,
            ownerAddress: tokenData.owner_address || null,
            ownerBalance: tokenData.owner_percent ? toPercent(tokenData.owner_percent) : null
        };
        
        // Process LP holders to find locked/burned amounts
        let lpBurnedPercent = 0;
        let lpLockedPercent = 0;
        let lpUnlockedPercent = 0;
        const lpDetails = [];
        
        if (result.lpHolders && result.lpHolders.length > 0) {
            for (const holder of result.lpHolders) {
                const percent = parseFloat(holder.percent) * 100 || 0;
                const addr = (holder.address || '').toLowerCase();
                const tag = holder.tag || '';
                const isLocked = holder.is_locked === 1 || holder.is_locked === '1';
                
                // Check if burned (dead addresses)
                const isBurned = addr.startsWith('0x0000000000000000000000000000000000000000') ||
                                 addr.startsWith('0x000000000000000000000000000000000000dead') ||
                                 addr.startsWith('0xdead') ||
                                 tag.toLowerCase().includes('burn') ||
                                 tag.toLowerCase().includes('dead');
                
                if (isBurned) {
                    lpBurnedPercent += percent;
                    lpDetails.push({ address: addr, percent, status: 'BURNED', tag: tag || 'Dead Address' });
                } else if (isLocked || tag.toLowerCase().includes('lock')) {
                    lpLockedPercent += percent;
                    lpDetails.push({ address: addr, percent, status: 'LOCKED', tag: tag || 'Locked' });
                } else {
                    lpUnlockedPercent += percent;
                    lpDetails.push({ address: addr, percent, status: 'UNLOCKED', tag: tag || 'Wallet' });
                }
            }
        }
        
        result.lpBurnedPercent = lpBurnedPercent;
        result.lpLockedPercent = lpLockedPercent;
        result.lpUnlockedPercent = lpUnlockedPercent;
        result.lpSafePercent = lpBurnedPercent + lpLockedPercent;
        result.lpDetails = lpDetails;
        
        // Calculate risk level
        let riskScore = 0;
        const issues = { critical: [], high: [], medium: [], info: [] };
        
        // Critical issues
        if (result.isHoneypot) {
            riskScore += 50;
            issues.critical.push('HONEYPOT DETECTED - Cannot sell tokens');
        }
        if (result.cannotBuy) {
            riskScore += 30;
            issues.critical.push('Cannot buy this token');
        }
        if (result.cannotSellAll) {
            riskScore += 25;
            issues.critical.push('Cannot sell all tokens at once');
        }
        
        // High risk - taxes
        const buyTaxNum = parseFloat(result.buyTax) || 0;
        const sellTaxNum = parseFloat(result.sellTax) || 0;
        
        if (sellTaxNum > 50) {
            riskScore += 30;
            issues.critical.push(`Extreme sell tax: ${result.sellTax}%`);
        } else if (sellTaxNum > 20) {
            riskScore += 15;
            issues.high.push(`High sell tax: ${result.sellTax}%`);
        } else if (sellTaxNum > 10) {
            riskScore += 5;
            issues.medium.push(`Moderate sell tax: ${result.sellTax}%`);
        }
        
        if (buyTaxNum > 20) {
            riskScore += 10;
            issues.high.push(`High buy tax: ${result.buyTax}%`);
        } else if (buyTaxNum > 10) {
            riskScore += 3;
            issues.medium.push(`Moderate buy tax: ${result.buyTax}%`);
        }
        
        // High risk - ownership
        if (result.canTakeBackOwnership) {
            riskScore += 15;
            issues.high.push('Owner can reclaim ownership after renouncing');
        }
        if (result.ownerCanChangeBalance) {
            riskScore += 20;
            issues.high.push('Owner can modify token balances');
        }
        if (result.hiddenOwner) {
            riskScore += 15;
            issues.high.push('Hidden owner detected');
        }
        if (result.isMintable) {
            riskScore += 10;
            issues.high.push('Token supply can be increased (mintable)');
        }
        
        // Medium risk
        if (result.isProxy) {
            riskScore += 10;
            issues.medium.push('Proxy contract (can be upgraded)');
        }
        if (result.transferPausable) {
            riskScore += 8;
            issues.medium.push('Transfers can be paused');
        }
        if (result.isBlacklisted) {
            riskScore += 8;
            issues.medium.push('Blacklist function exists');
        }
        if (result.tradingCooldown) {
            riskScore += 5;
            issues.medium.push('Trading cooldown enabled');
        }
        if (result.slippageModifiable) {
            riskScore += 5;
            issues.medium.push('Slippage can be modified by owner');
        }
        if (result.isAntiWhale) {
            riskScore += 3;
            issues.medium.push('Anti-whale mechanism active');
        }
        
        // Info/positive
        if (!result.isOpenSource) {
            riskScore += 10;
            issues.medium.push('Contract is not open source');
        } else {
            issues.info.push('Contract is open source (verified)');
        }
        
        if (result.isAirdropScam) {
            riskScore += 25;
            issues.critical.push('Flagged as airdrop scam');
        }
        
        if (result.isInDex) {
            issues.info.push('Token is listed on DEX');
        }
        
        // LP risk assessment
        if (result.lpSafePercent < 20 && result.lpHolders.length > 0) {
            riskScore += 20;
            issues.critical.push(`Only ${result.lpSafePercent.toFixed(1)}% LP is secured - HIGH RUG RISK`);
        } else if (result.lpSafePercent < 50 && result.lpHolders.length > 0) {
            riskScore += 10;
            issues.high.push(`${result.lpSafePercent.toFixed(1)}% LP secured - some rug risk`);
        } else if (result.lpSafePercent >= 80 && result.lpHolders.length > 0) {
            issues.info.push(`${result.lpSafePercent.toFixed(1)}% LP is locked/burned (good)`);
        }
        
        // Cap score
        riskScore = Math.min(riskScore, 100);
        
        // Determine risk level
        let riskLevel;
        if (riskScore >= 60 || result.isHoneypot) {
            riskLevel = 'CRITICAL';
        } else if (riskScore >= 40) {
            riskLevel = 'HIGH';
        } else if (riskScore >= 20) {
            riskLevel = 'MEDIUM';
        } else {
            riskLevel = 'LOW';
        }
        
        result.riskScore = riskScore;
        result.riskLevel = riskLevel;
        result.issues = issues;
        
        // Print report
        console.log('');
        console.log('----------------------------------------');
        console.log('HONEYPOT STATUS');
        console.log('----------------------------------------');
        
        if (result.isHoneypot) {
            console.log('[!!!] THIS IS A HONEYPOT');
            console.log('[!!!] YOU WILL NOT BE ABLE TO SELL');
        } else {
            console.log('[OK] Not detected as honeypot');
        }
        
        console.log('');
        console.log('----------------------------------------');
        console.log('TRADING TAXES');
        console.log('----------------------------------------');
        console.log(`Buy Tax:  ${result.buyTax !== null ? result.buyTax + '%' : 'Unknown'}`);
        console.log(`Sell Tax: ${result.sellTax !== null ? result.sellTax + '%' : 'Unknown'}`);
        
        if (sellTaxNum > 10 || buyTaxNum > 10) {
            console.log('');
            console.log('[!] High taxes detected - check if acceptable');
        }
        
        console.log('');
        console.log('----------------------------------------');
        console.log('CONTRACT SECURITY');
        console.log('----------------------------------------');
        console.log(`Open Source:     ${result.isOpenSource ? 'Yes' : 'No'}`);
        console.log(`Proxy Contract:  ${result.isProxy ? 'Yes (RISKY)' : 'No'}`);
        console.log(`Mintable:        ${result.isMintable ? 'Yes (RISKY)' : 'No'}`);
        console.log(`Hidden Owner:    ${result.hiddenOwner ? 'Yes (RISKY)' : 'No'}`);
        console.log(`Can Reclaim:     ${result.canTakeBackOwnership ? 'Yes (RISKY)' : 'No'}`);
        console.log(`Change Balance:  ${result.ownerCanChangeBalance ? 'Yes (CRITICAL)' : 'No'}`);
        
        console.log('');
        console.log('----------------------------------------');
        console.log('TRADING RESTRICTIONS');
        console.log('----------------------------------------');
        console.log(`Cannot Buy:      ${result.cannotBuy ? 'Yes (CRITICAL)' : 'No'}`);
        console.log(`Cannot Sell All: ${result.cannotSellAll ? 'Yes (RISKY)' : 'No'}`);
        console.log(`Pausable:        ${result.transferPausable ? 'Yes' : 'No'}`);
        console.log(`Blacklist:       ${result.isBlacklisted ? 'Yes' : 'No'}`);
        console.log(`Cooldown:        ${result.tradingCooldown ? 'Yes' : 'No'}`);
        console.log(`Anti-Whale:      ${result.isAntiWhale ? 'Yes' : 'No'}`);
        
        console.log('');
        console.log('----------------------------------------');
        console.log('LIQUIDITY (LP) SECURITY');
        console.log('----------------------------------------');
        
        if (result.lpHolders.length > 0) {
            console.log(`LP Holders:      ${result.lpHolderCount}`);
            console.log(`LP Burned:       ${result.lpBurnedPercent.toFixed(2)}%`);
            console.log(`LP Locked:       ${result.lpLockedPercent.toFixed(2)}%`);
            console.log(`LP Safe Total:   ${result.lpSafePercent.toFixed(2)}%`);
            console.log(`LP At Risk:      ${result.lpUnlockedPercent.toFixed(2)}%`);
            
            if (result.lpDetails.length > 0) {
                console.log('');
                console.log('Top LP Holders:');
                result.lpDetails.slice(0, 5).forEach((lp, i) => {
                    const statusIcon = lp.status === 'BURNED' ? '[BURNED]' : 
                                       lp.status === 'LOCKED' ? '[LOCKED]' : '[AT RISK]';
                    console.log(`  ${i + 1}. ${lp.percent.toFixed(2)}% - ${statusIcon} ${lp.tag}`);
                    console.log(`     ${lp.address}`);
                });
            }
            
            if (result.lpSafePercent >= 80) {
                console.log('');
                console.log('[+] Good: Most LP is locked or burned');
            } else if (result.lpSafePercent < 50) {
                console.log('');
                console.log('[!] WARNING: Less than 50% LP is secured - RUG RISK');
            }
        } else {
            console.log('No LP holder data available');
        }
        
        console.log('');
        console.log('----------------------------------------');
        console.log('ISSUES FOUND');
        console.log('----------------------------------------');
        
        if (issues.critical.length > 0) {
            console.log('');
            console.log('CRITICAL:');
            issues.critical.forEach(i => console.log(`  [!!!] ${i}`));
        }
        if (issues.high.length > 0) {
            console.log('');
            console.log('HIGH RISK:');
            issues.high.forEach(i => console.log(`  [!] ${i}`));
        }
        if (issues.medium.length > 0) {
            console.log('');
            console.log('MEDIUM RISK:');
            issues.medium.forEach(i => console.log(`  [-] ${i}`));
        }
        if (issues.info.length > 0) {
            console.log('');
            console.log('INFO:');
            issues.info.forEach(i => console.log(`  [i] ${i}`));
        }
        
        if (issues.critical.length === 0 && issues.high.length === 0 && issues.medium.length === 0) {
            console.log('[+] No significant issues found');
        }
        
        console.log('');
        console.log('========================================');
        console.log(`HONEYPOT RISK: ${riskLevel}`);
        console.log(`RISK SCORE: ${riskScore}/100`);
        console.log('========================================');
        
        return result;
        
    } catch (error) {
        console.log(`Error: ${error.message}`);
        return {
            success: false,
            error: error.message,
            risk: 'UNKNOWN'
        };
    }
}

// ================================================================
// CLI
// ================================================================

const tokenAddress = process.argv[2];
const chain = process.argv[3] || 'ethereum';

if (!tokenAddress) {
    console.log('');
    console.log('Usage: node 8-honeypot-detection.js <TOKEN_ADDRESS> [CHAIN]');
    console.log('');
    console.log('Examples:');
    console.log('  node 8-honeypot-detection.js 0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE');
    console.log('  node 8-honeypot-detection.js 0x... bsc');
    console.log('');
    console.log('Supported chains: ethereum, bsc, polygon, arbitrum, base');
    console.log('');
    console.log('This module checks:');
    console.log('  - Honeypot status (can you sell?)');
    console.log('  - Buy/sell taxes');
    console.log('  - Proxy contracts');
    console.log('  - Mintable supply');
    console.log('  - Hidden owners');
    console.log('  - Trading restrictions');
    console.log('');
} else {
    checkHoneypot(tokenAddress, chain);
}

module.exports = { checkHoneypot };

