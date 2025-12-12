
// ================================================================
// RUG CHECKER TELEGRAM BOT - Interactive Version
// ================================================================

const TelegramBot = require('node-telegram-bot-api');
const { silentScan, formatSmallNumber } = require('./rug-checker');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';

// Store scan results for callback buttons
const scanCache = new Map();

// ================================================================
// HELPERS
// ================================================================

function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function esc(text) {
    if (typeof text !== 'string') text = String(text);
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function getRiskEmoji(level) {
    switch(level) {
        case 'CRITICAL': return '🔴';
        case 'HIGH': return '🟠';
        case 'MEDIUM': return '🟡';
        case 'LOW': return '🟢';
        default: return '⚪';
    }
}

function shortAddr(addr) {
    if (!addr) return 'Unknown';
    return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatAge(days) {
    if (days === null || days === undefined) return 'Unknown';
    if (days < 1) return `${Math.floor(days * 24)}h`;
    if (days < 30) return `${days}d`;
    if (days < 365) return `${Math.floor(days / 30)}mo`;
    return `${Math.floor(days / 365)}y ${Math.floor((days % 365) / 30)}mo`;
}

// ================================================================
// FORMAT SUMMARY (Clean Compact View)
// ================================================================

function formatSummary(tokenAddress, scanData) {
    const { results, riskScore, riskLevel } = scanData;
    const { tokenInfo, contractScan, liquidity, holders, honeypot, sentiment } = results;
    
    let msg = '';
    const emoji = getRiskEmoji(riskLevel);
    
    // Token Name with risk
    if (tokenInfo?.success) {
        msg += `${emoji} *${esc(tokenInfo.name)}* \\(${esc(tokenInfo.symbol)}\\)\n\n`;
    } else {
        msg += `${emoji} *Token Scan*\n\n`;
    }
    
    // Contract status line
    if (contractScan?.success) {
        msg += `✅ \\| Verified Contract\n`;
    } else {
        msg += `❌ \\| Unverified Contract\n`;
    }
    
    // Owner
    if (tokenInfo?.success) {
        if (tokenInfo.ownerStatus === 'renounced') {
            msg += `👤 \\| Ownership: Renounced\n`;
        } else if (tokenInfo.ownerStatus === 'active') {
            msg += `👤 \\| Ownership: Active ⚠️\n`;
        } else {
            msg += `👤 \\| Ownership: Unknown\n`;
        }
    }
    
    // Age
    if (tokenInfo?.success && tokenInfo.contractAge !== null) {
        msg += `⏰ \\| Age: ${esc(formatAge(tokenInfo.contractAge))}\n`;
    }
    
    msg += `\n`;
    
    // Market Data
    if (liquidity?.success) {
        msg += `💲 \\| Price: \\$${esc(formatSmallNumber(liquidity.priceInUSD))}\n`;
        msg += `💎 \\| MC: \\$${esc(liquidity.marketCap.toLocaleString())}\n`;
        
        // Liquidity with percentage of MC
        const liqPercent = liquidity.marketCap > 0 ? ((liquidity.liquidityUSD / liquidity.marketCap) * 100).toFixed(1) : 0;
        msg += `💧 \\| Liq: \\$${esc(liquidity.liquidityUSD.toLocaleString())} \\(${esc(liqPercent)}%\\)\n`;
    }
    
    // Tax
    if (honeypot?.success && honeypot.buyTax !== null) {
        msg += `💳 \\| Tax: B: ${esc(honeypot.buyTax.toFixed(1))}% \\| S: ${esc(honeypot.sellTax.toFixed(1))}%\n`;
    }
    
    // LP Lock
    if (liquidity?.success) {
        msg += `🔒 \\| LP Lock: ${esc(liquidity.safePercent.toFixed(1))}%`;
        if (liquidity.burnedPercent > 50) {
            msg += ` burned\n`;
        } else if (liquidity.lockedPercent > 50) {
            msg += ` locked\n`;
        } else {
            msg += ` ⚠️\n`;
        }
    }
    
    // Supply
    if (tokenInfo?.success) {
        const supplyNum = Number(tokenInfo.circulatingSupply || tokenInfo.totalSupply);
        let supplyStr;
        if (supplyNum >= 1e12) supplyStr = (supplyNum / 1e12).toFixed(1) + 'T';
        else if (supplyNum >= 1e9) supplyStr = (supplyNum / 1e9).toFixed(1) + 'B';
        else if (supplyNum >= 1e6) supplyStr = (supplyNum / 1e6).toFixed(1) + 'M';
        else if (supplyNum >= 1e3) supplyStr = (supplyNum / 1e3).toFixed(1) + 'K';
        else supplyStr = supplyNum.toLocaleString();
        msg += `🟢 \\| Supply: ${esc(supplyStr)}\n`;
    }
    
    // Holders
    if (holders?.success) {
        const holderCount = holders.topHolders?.length || 0;
        msg += `👩‍👧‍👦 \\| Top 10: ${esc(holders.top10Percent.toFixed(2))}%\n`;
    }
    
    msg += `\n`;
    
    // Price Changes
    if (sentiment?.success) {
        const h24 = sentiment.priceChange24h;
        const sign = h24 >= 0 ? '+' : '';
        const changeEmoji = h24 >= 0 ? '📈' : '📉';
        msg += `${changeEmoji} \\| 24h: ${esc(sign)}${esc(h24.toFixed(2))}%\n`;
    }
    
    msg += `\n`;
    
    // Social Links
    if (sentiment?.success) {
        const links = [];
        if (sentiment.websites?.length > 0) {
            links.push(`[Website](${sentiment.websites[0].url})`);
        }
        sentiment.socials?.forEach(s => {
            if (s.type === 'twitter') links.push(`[𝕏](${s.url})`);
            else if (s.type === 'telegram') links.push(`[Telegram](${s.url})`);
        });
        if (links.length > 0) {
            msg += `🔗 Links: ${links.join(' • ')}\n`;
        }
    }
    
    msg += `\n`;
    
    // Contract Address
    msg += `\`${tokenAddress}\`\n\n`;
    
    // Risk Score
    const bar = '█'.repeat(Math.floor(riskScore / 10)) + '░'.repeat(10 - Math.floor(riskScore / 10));
    msg += `${emoji} *Risk: ${riskLevel}* \\(${riskScore}/100\\)\n`;
    msg += `\\[${bar}\\]\n`;
    
    return msg;
}

// ================================================================
// FORMAT FULL REPORT (Comprehensive - Like CLI)
// ================================================================

function formatFullReport(tokenAddress, scanData) {
    const { results, riskScore, riskLevel } = scanData || {};
    const { tokenInfo, contractScan, liquidity, holders, honeypot, sentiment } = results || {};
    
    let msg = '';
    
    // Safe accessor helper
    const safe = (fn, fallback = 'N/A') => {
        try { return fn(); } catch { return fallback; }
    };
    
    // ═══════════════════════════════════════
    // HEADER
    // ═══════════════════════════════════════
    msg += `════════════════════════════════\n`;
    msg += `🔍 *RUG CHECKER \\- Full Report*\n`;
    msg += `════════════════════════════════\n`;
    msg += `Token: \`${tokenAddress}\`\n`;
    msg += `Chain: Ethereum Mainnet\n`;
    msg += `Time: ${esc(new Date().toISOString())}\n`;
    msg += `════════════════════════════════\n\n`;
    
    // ═══════════════════════════════════════
    // 1. TOKEN INFO
    // ═══════════════════════════════════════
    msg += `*\\[INFO\\] 1\\. TOKEN INFO*\n`;
    msg += `──────────────────────────────\n`;
    try {
        if (tokenInfo?.success) {
            msg += `Contract: \`${esc(shortAddr(tokenAddress))}\`\n`;
            msg += `Name: ${esc(tokenInfo.name || 'Unknown')}\n`;
            msg += `Symbol: ${esc(tokenInfo.symbol || '?')}\n`;
            msg += `Decimals: ${tokenInfo.decimals || 18}\n`;
            msg += `Total Supply: ${esc(Number(tokenInfo.totalSupply || 0).toLocaleString())}\n`;
            if (tokenInfo.burnedPercent && tokenInfo.burnedPercent > 0) {
                msg += `Burned: ${esc(Number(tokenInfo.burnedSupply || 0).toLocaleString())} \\(${esc((tokenInfo.burnedPercent || 0).toFixed(2))}%\\)\n`;
                msg += `Circulating: ${esc(Number(tokenInfo.circulatingSupply || 0).toLocaleString())}\n`;
            }
            msg += `Owner: \`${esc(shortAddr(tokenInfo.owner))}\``;
            if (tokenInfo.ownerStatus === 'renounced') {
                msg += ` \\[BURN ADDRESS\\]\n`;
                msg += `Owner Status: RENOUNCED\n`;
            } else {
                msg += `\n`;
                msg += `Owner Status: ${esc((tokenInfo.ownerStatus || 'unknown').toUpperCase())}\n`;
            }
            if (tokenInfo.contractAge !== null && tokenInfo.contractAge !== undefined) {
                const years = Math.floor(tokenInfo.contractAge / 365);
                let created = 'Unknown';
                try {
                    if (tokenInfo.creationDate) {
                        if (typeof tokenInfo.creationDate === 'string') {
                            created = tokenInfo.creationDate.split('T')[0];
                        } else if (tokenInfo.creationDate instanceof Date) {
                            created = tokenInfo.creationDate.toISOString().split('T')[0];
                        }
                    }
                } catch { created = 'Unknown'; }
                if (years >= 1) {
                    msg += `Age: ${years} years \\(created ${esc(created)}\\)\n`;
                } else {
                    msg += `Age: ${tokenInfo.contractAge} days \\(created ${esc(created)}\\)\n`;
                }
            }
            msg += `Risk: ${esc(tokenInfo.risk || 'UNKNOWN')}\n`;
        } else {
            msg += `Error: ${esc(tokenInfo?.error || 'Could not fetch token info')}\n`;
        }
    } catch (e) {
        msg += `Error: Token info unavailable\n`;
    }
    msg += `\n`;
    
    // ═══════════════════════════════════════
    // 2. CONTRACT FUNCTIONS
    // ═══════════════════════════════════════
    msg += `*\\[INFO\\] 2\\. CONTRACT FUNCTIONS*\n`;
    msg += `──────────────────────────────\n`;
    try {
        if (contractScan?.success) {
            msg += `Verified: ✅ Yes\n`;
            msg += `Total Funcs: ${contractScan.functionCount || 0}\n`;
            msg += `Critical: ${contractScan.findings?.critical?.length || 0} issues\n`;
            msg += `High: ${contractScan.findings?.high?.length || 0} issues\n`;
            msg += `Medium: ${contractScan.findings?.medium?.length || 0} issues\n`;
            if (contractScan.findings?.critical?.length > 0) {
                msg += `\n⚠️ Critical Functions:\n`;
                contractScan.findings.critical.forEach(f => {
                    msg += `  • ${esc(f.name || 'unknown')}\\(\\)\n`;
                });
            }
            if (contractScan.findings?.high?.length > 0) {
                msg += `\n⚠️ High Risk Functions:\n`;
                contractScan.findings.high.forEach(f => {
                    msg += `  • ${esc(f.name || 'unknown')}\\(\\)\n`;
                });
            }
            msg += `\nRisk: ${esc(contractScan.risk || 'UNKNOWN')}\n`;
        } else {
            msg += `Verified: ❌ No\n`;
            msg += `Note: Unverified contracts are higher risk\n`;
        }
    } catch (e) {
        msg += `Error: Contract data unavailable\n`;
    }
    msg += `\n`;
    
    // ═══════════════════════════════════════
    // 3. LIQUIDITY & MARKET DATA
    // ═══════════════════════════════════════
    msg += `*\\[INFO\\] 3\\. LIQUIDITY & MARKET DATA*\n`;
    msg += `──────────────────────────────\n`;
    try {
        if (liquidity?.success) {
            msg += `*PRICE & MARKET DATA:*\n`;
            msg += `ETH Price: \\$${esc((liquidity.ethPrice || 0).toLocaleString())}\n`;
            msg += `Token Price: \\$${esc(formatSmallNumber(liquidity.priceInUSD || 0))}\n`;
            msg += `Token Price: ${esc(formatSmallNumber(liquidity.priceInETH || 0))} ETH\n`;
            msg += `Market Cap: \\$${esc((liquidity.marketCap || 0).toLocaleString())}\n`;
            msg += `FDV: \\$${esc((liquidity.fdv || 0).toLocaleString())}\n`;
            msg += `\n*LIQUIDITY POOL:*\n`;
            if (liquidity.pairAddress) {
                msg += `Pool Address: \`${esc(shortAddr(liquidity.pairAddress))}\`\n`;
            }
            msg += `WETH in Pool: ${esc((liquidity.wethInPool || 0).toFixed(4))} ETH\n`;
            msg += `Liquidity: \\$${esc((liquidity.liquidityUSD || 0).toLocaleString())}\n`;
            msg += `\n*LP TOKEN SECURITY:*\n`;
            msg += `LP Burned: ${esc((liquidity.burnedPercent || 0).toFixed(2))}%\n`;
            msg += `LP Locked: ${esc((liquidity.lockedPercent || 0).toFixed(2))}%\n`;
            msg += `LP Safe: ${esc((liquidity.safePercent || 0).toFixed(2))}%\n`;
            msg += `LP At Risk: ${esc((100 - (liquidity.safePercent || 0)).toFixed(2))}%\n`;
            msg += `\nRisk: ${esc(liquidity.risk || 'UNKNOWN')}\n`;
        } else {
            msg += `Error: ${esc(liquidity?.error || 'No liquidity pool found')}\n`;
        }
    } catch (e) {
        msg += `Error: Liquidity data unavailable\n`;
    }
    msg += `\n`;
    
    // ═══════════════════════════════════════
    // 4. HOLDER DISTRIBUTION
    // ═══════════════════════════════════════
    msg += `*\\[INFO\\] 4\\. HOLDER DISTRIBUTION*\n`;
    msg += `──────────────────────────────\n`;
    try {
        if (holders?.success) {
            msg += `*SUPPLY DISTRIBUTION:*\n`;
            msg += `Burned/Dead: ${esc((holders.burnedPercent || 0).toFixed(2))}%\n`;
            msg += `Circulating: ${esc((100 - (holders.burnedPercent || 0)).toFixed(2))}%\n`;
            msg += `\n*CONCENTRATION:*\n`;
            msg += `Top 1 Holder: ${esc((holders.top1Percent || 0).toFixed(2))}%\n`;
            if (holders.topHolders?.length >= 5) {
                const top5 = holders.topHolders.slice(0, 5).reduce((a, h) => a + (h.percent || 0), 0);
                msg += `Top 5 Hold: ${esc(top5.toFixed(2))}%\n`;
            }
            msg += `Top 10 Hold: ${esc((holders.top10Percent || 0).toFixed(2))}%\n`;
            if (holders.topHolders?.length > 0) {
                msg += `\n*TOP 5 HOLDERS:*\n`;
                holders.topHolders.slice(0, 5).forEach((h, i) => {
                    msg += `  ${i + 1}\\. \`${esc(shortAddr(h.address))}\`\n`;
                    msg += `     Holding: ${esc((h.percent || 0).toFixed(2))}%\n`;
                });
            }
            msg += `\nRisk: ${esc(holders.risk || 'UNKNOWN')}\n`;
        } else {
            msg += `Error: ${esc(holders?.error || 'No holder data')}\n`;
        }
    } catch (e) {
        msg += `Error: Holder data unavailable\n`;
    }
    msg += `\n`;
    
    // ═══════════════════════════════════════
    // 5. HONEYPOT DETECTION
    // ═══════════════════════════════════════
    msg += `*\\[INFO\\] 5\\. HONEYPOT DETECTION*\n`;
    msg += `──────────────────────────────\n`;
    try {
        if (honeypot?.success) {
            msg += `*HONEYPOT STATUS:*\n`;
            msg += `Status: ${honeypot.isHoneypot ? '❌ HONEYPOT DETECTED' : '✅ Not a honeypot'}\n`;
            msg += `\n*TRADING TAXES:*\n`;
            msg += `Buy Tax: ${honeypot.buyTax != null ? esc((honeypot.buyTax || 0).toFixed(2)) + '%' : 'Unknown'}\n`;
            msg += `Sell Tax: ${honeypot.sellTax != null ? esc((honeypot.sellTax || 0).toFixed(2)) + '%' : 'Unknown'}\n`;
            msg += `\n*CONTRACT FLAGS:*\n`;
            msg += `Open Source: ${honeypot.isOpenSource ? '✅ Yes' : '❌ No'}\n`;
            msg += `Proxy: ${honeypot.isProxy ? '⚠️ Yes' : '✅ No'}\n`;
            msg += `Mintable: ${honeypot.isMintable ? '⚠️ Yes' : '✅ No'}\n`;
            msg += `Hidden Owner: ${honeypot.hasHiddenOwner ? '⚠️ Yes' : '✅ No'}\n`;
            msg += `Can Reclaim: ${honeypot.canReclaim ? '⚠️ Yes' : '✅ No'}\n`;
            msg += `\n*TRADING FLAGS:*\n`;
            msg += `Cannot Buy: ${honeypot.cannotBuy ? '❌ Yes' : '✅ No'}\n`;
            msg += `Cannot Sell: ${honeypot.cannotSell ? '❌ Yes' : '✅ No'}\n`;
            msg += `Pausable: ${honeypot.isPausable ? '⚠️ Yes' : '✅ No'}\n`;
            msg += `Blacklist: ${honeypot.isBlacklisted ? '⚠️ Yes' : '✅ No'}\n`;
            msg += `Anti\\-Whale: ${honeypot.isAntiWhale ? '⚠️ Yes' : '✅ No'}\n`;
            
            if (honeypot.lpHolders?.length > 0) {
                msg += `\n*LP SECURITY:*\n`;
                msg += `LP Holders: ${honeypot.lpHolders.length}\n`;
                msg += `LP Burned: ${esc((honeypot.lpBurnedPercent || 0).toFixed(2))}%\n`;
                msg += `LP Locked: ${esc((honeypot.lpLockedPercent || 0).toFixed(2))}%\n`;
                msg += `LP Safe: ${esc((honeypot.lpSafePercent || 0).toFixed(2))}%\n`;
                msg += `LP At Risk: ${esc((100 - (honeypot.lpSafePercent || 0)).toFixed(2))}%\n`;
                msg += `\n*TOP LP HOLDERS:*\n`;
                honeypot.lpHolders.slice(0, 3).forEach((lp, i) => {
                    const status = lp.is_locked ? '[LOCKED]' : lp.is_burned ? '[BURNED]' : '[AT RISK]';
                    msg += `  ${i + 1}\\. ${esc((lp.percent || 0).toFixed(2))}% ${esc(status)} ${esc(lp.tag || 'Wallet')}\n`;
                });
            }
            msg += `\nRisk: ${esc(honeypot.risk || 'UNKNOWN')}\n`;
        } else {
            msg += `Error: ${esc(honeypot?.error || 'Token not in security database')}\n`;
        }
    } catch (e) {
        msg += `Error: Security data unavailable\n`;
    }
    msg += `\n`;
    
    // ═══════════════════════════════════════
    // 6. SOCIAL & MARKET SENTIMENT
    // ═══════════════════════════════════════
    msg += `*\\[INFO\\] 6\\. SOCIAL & MARKET SENTIMENT*\n`;
    msg += `──────────────────────────────\n`;
    try {
        if (sentiment?.success) {
            msg += `*PRICE ACTION:*\n`;
            const fmt = (v) => {
                const val = v || 0;
                const sign = val >= 0 ? '+' : '';
                return esc(sign + val.toFixed(2)) + '%';
            };
            msg += `5 min: ${fmt(sentiment.priceChange5m)}\n`;
            msg += `1 hour: ${fmt(sentiment.priceChange1h)}\n`;
            if (sentiment.priceChange6h !== undefined) {
                msg += `6 hours: ${fmt(sentiment.priceChange6h)}\n`;
            }
            msg += `24 hours: ${fmt(sentiment.priceChange24h)}\n`;
            msg += `\n*TRADING ACTIVITY:*\n`;
            msg += `Volume 24h: \\$${esc((sentiment.volume24h || 0).toLocaleString())}\n`;
            if (sentiment.volumeActivity) {
                msg += `Activity: ${esc(sentiment.volumeActivity)}\n`;
            }
            msg += `Buys 24h: ${sentiment.txns24h?.buys || 0}\n`;
            msg += `Sells 24h: ${sentiment.txns24h?.sells || 0}\n`;
            msg += `Buy Ratio: ${esc(sentiment.buyRatio || 0)}%\n`;
            msg += `\n*SENTIMENT:*\n`;
            msg += `Score: ${sentiment.sentimentScore || 0}/100\n`;
            msg += `Level: ${esc(sentiment.sentimentLevel || 'UNKNOWN')}\n`;
            
            // Social Links
            if (sentiment.websites?.length > 0 || sentiment.socials?.length > 0) {
                msg += `\n*SOCIAL LINKS:*\n`;
                sentiment.websites?.forEach(w => {
                    if (w.url) msg += `  \\[WEB\\] ${esc(w.url)}\n`;
                });
                sentiment.socials?.forEach(s => {
                    if (s.type && s.url) {
                        const type = s.type.toUpperCase();
                        msg += `  \\[${esc(type)}\\] ${esc(s.url)}\n`;
                    }
                });
            }
            
            // Quick Links
            msg += `\n*QUICK LINKS:*\n`;
            if (sentiment.pairAddress) {
                msg += `  DexScreener: dexscreener\\.com/ethereum/${esc(sentiment.pairAddress)}\n`;
            }
            msg += `  Etherscan: etherscan\\.io/token/${esc(tokenAddress)}\n`;
            if (sentiment.pairAddress) {
                msg += `  DEXTools: dextools\\.io/app/ether/pair\\-explorer/${esc(sentiment.pairAddress)}\n`;
            }
        } else {
            msg += `Error: ${esc(sentiment?.error || 'Token not found on DexScreener')}\n`;
        }
    } catch (e) {
        msg += `Error: Sentiment data unavailable\n`;
    }
    msg += `\n`;
    
    // ═══════════════════════════════════════
    // FINAL RISK ASSESSMENT
    // ═══════════════════════════════════════
    msg += `════════════════════════════════\n`;
    msg += `*FINAL RISK ASSESSMENT*\n`;
    msg += `════════════════════════════════\n\n`;
    
    msg += `*RISK BY CATEGORY:*\n`;
    msg += `Token Info: ${esc(tokenInfo?.risk || 'UNKNOWN')}\n`;
    msg += `Contract: ${esc(contractScan?.risk || 'UNKNOWN')}\n`;
    msg += `Liquidity: ${esc(liquidity?.risk || 'UNKNOWN')}\n`;
    msg += `Holders: ${esc(holders?.risk || 'UNKNOWN')}\n`;
    msg += `Honeypot: ${esc(honeypot?.risk || 'UNKNOWN')}\n`;
    msg += `Sentiment: ${esc(sentiment?.sentimentLevel || 'UNKNOWN')}\n\n`;
    
    const emoji = getRiskEmoji(riskLevel);
    const bar = '█'.repeat(Math.floor(riskScore / 10)) + '░'.repeat(10 - Math.floor(riskScore / 10));
    msg += `════════════════════════════════\n`;
    msg += `${emoji} *OVERALL RISK: ${riskLevel}*\n`;
    msg += `*SCORE: ${riskScore}/100*\n`;
    msg += `\\[${bar}\\]\n`;
    msg += `════════════════════════════════\n\n`;
    
    // Key Findings
    msg += `*KEY FINDINGS:*\n`;
    
    try {
        if (tokenInfo?.success && tokenInfo.contractAge != null) {
            if (tokenInfo.contractAge >= 365) {
                msg += `\\[\\+\\] Established token \\(${Math.floor(tokenInfo.contractAge / 365)} years\\)\n`;
            } else if (tokenInfo.contractAge < 7) {
                msg += `\\[\\!\\] Very new token \\(${tokenInfo.contractAge} days\\)\n`;
            }
        }
        
        if (tokenInfo?.success && tokenInfo.ownerStatus === 'renounced') {
            msg += `\\[\\+\\] Ownership BURNED \\- no owner control\n`;
        } else if (tokenInfo?.ownerStatus === 'active') {
            msg += `\\[\\-\\] Owner still active\n`;
        }
        
        if (contractScan?.success) {
            const critLen = contractScan.findings?.critical?.length || 0;
            const highLen = contractScan.findings?.high?.length || 0;
            if (critLen === 0 && highLen === 0) {
                msg += `\\[\\+\\] No critical functions detected\n`;
            } else {
                msg += `\\[\\!\\] ${critLen + highLen} risky functions found\n`;
            }
        }
        
        if (liquidity?.success) {
            if ((liquidity.liquidityUSD || 0) > 100000) {
                msg += `\\[\\+\\] Good liquidity \\(\\$${esc((liquidity.liquidityUSD || 0).toLocaleString())}\\)\n`;
            } else if ((liquidity.liquidityUSD || 0) < 10000) {
                msg += `\\[\\-\\] Low liquidity\n`;
            }
            
            if ((liquidity.safePercent || 0) >= 80) {
                msg += `\\[\\+\\] ${esc((liquidity.safePercent || 0).toFixed(1))}% of LP locked/burned\n`;
            } else if ((liquidity.safePercent || 0) < 50) {
                msg += `\\[\\!\\] Only ${esc((liquidity.safePercent || 0).toFixed(1))}% LP secured\n`;
            }
        }
        
        if (honeypot?.success) {
            if (honeypot.isHoneypot) {
                msg += `\\[\\!\\!\\!\\] HONEYPOT DETECTED\n`;
            } else {
                msg += `\\[\\+\\] Not a honeypot \\(verified\\)\n`;
            }
            
            if (honeypot.sellTax != null && honeypot.buyTax != null) {
                if ((honeypot.sellTax || 0) <= 5 && (honeypot.buyTax || 0) <= 5) {
                    msg += `\\[\\+\\] Low taxes \\(Buy: ${esc((honeypot.buyTax || 0).toFixed(1))}%, Sell: ${esc((honeypot.sellTax || 0).toFixed(1))}%\\)\n`;
                } else if ((honeypot.sellTax || 0) > 20) {
                    msg += `\\[\\!\\] High sell tax: ${esc((honeypot.sellTax || 0).toFixed(1))}%\n`;
                }
            }
        }
        
        if (sentiment?.success) {
            msg += `\\[i\\] Sentiment: ${esc(sentiment.sentimentLevel || 'UNKNOWN')} \\(${sentiment.sentimentScore || 0}/100\\)\n`;
            if (sentiment.websites?.length > 0 || sentiment.socials?.length > 0) {
                msg += `\\[\\+\\] Has website and social media\n`;
            }
        }
    } catch (e) {
        // Skip findings on error
    }
    
    msg += `\n`;
    
    // Recommendations
    msg += `*RECOMMENDATIONS:*\n`;
    if (riskScore >= 75) {
        msg += `🔴 *EXTREME RISK \\- DO NOT INVEST*\n`;
    } else if (riskScore >= 50) {
        msg += `🟠 *HIGH RISK \\- Significant concerns*\n`;
    } else if (riskScore >= 25) {
        msg += `🟡 *MEDIUM RISK \\- Proceed with caution*\n`;
    } else {
        msg += `🟢 *LOW RISK \\- Basic checks passed*\n`;
        msg += `Always DYOR \\- past safety ≠ future safety\n`;
    }
    
    msg += `\n`;
    msg += `*DISCLAIMER:*\n`;
    msg += `Technical analysis only\\. Cannot detect:\n`;
    msg += `• Social engineering scams\n`;
    msg += `• Future contract changes\n`;
    msg += `• Market manipulation\n`;
    msg += `Never invest more than you can lose\\.\n`;
    
    return msg;
}

// ================================================================
// BOT SETUP
// ================================================================

if (BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
    console.log('\nSet your bot token: $env:TELEGRAM_BOT_TOKEN="your_token"');
    console.log('Then run: npm run bot\n');
    process.exit(0);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('\n══════════════════════════════');
console.log('RUG0xRADAR BOT STARTED');
console.log('══════════════════════════════\n');

// ================================================================
// COMMANDS
// ================================================================

bot.onText(/\/start/, (msg) => {
    const keyboard = {
        inline_keyboard: [
            [{ text: '📖 How to Use', callback_data: 'help' }]
        ]
    };
    
    bot.sendMessage(msg.chat.id, `
🔍 *Rug0xRadar*

Your token security scanner\\.

Paste any Ethereum token address to scan\\!

Features:
• Honeypot detection
• Tax analysis
• LP security
• Holder analysis
• Market sentiment
    `, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `
*How to use:*

1\\. Paste a token contract address
2\\. Get instant summary
3\\. Click "Full Report" for details

*Risk Levels:*
🟢 LOW \\- Looks safe
🟡 MEDIUM \\- Be careful
🟠 HIGH \\- Risky
🔴 CRITICAL \\- Avoid
    `, { parse_mode: 'MarkdownV2' });
});

// ================================================================
// SCAN HANDLER
// ================================================================

async function handleScan(chatId, tokenAddress, messageId = null) {
    let loadingMsg;
    if (messageId) {
        await bot.editMessageText('🔍 Scanning\\.\\.\\.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'MarkdownV2'
        });
        loadingMsg = { message_id: messageId };
    } else {
        loadingMsg = await bot.sendMessage(chatId, '🔍 Scanning\\.\\.\\.', { parse_mode: 'MarkdownV2' });
    }
    
    try {
        const scanData = await silentScan(tokenAddress);
        
        // Cache for button callbacks
        const cacheKey = `${chatId}_${tokenAddress}`;
        scanCache.set(cacheKey, scanData);
        
        if (scanCache.size > 100) {
            const firstKey = scanCache.keys().next().value;
            scanCache.delete(firstKey);
        }
        
        const summary = formatSummary(tokenAddress, scanData);
        
        // Build keyboard
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📋 Full Report', callback_data: `full_${tokenAddress}` },
                    { text: '🔄 Rescan', callback_data: `scan_${tokenAddress}` }
                ],
                [
                    { text: '📊 DexScreener', url: `https://dexscreener.com/ethereum/${tokenAddress}` },
                    { text: '🔍 Etherscan', url: `https://etherscan.io/token/${tokenAddress}` }
                ]
            ]
        };
        
        // Add socials if available
        if (scanData.results.sentiment?.success) {
            const { socials = [], websites = [] } = scanData.results.sentiment;
            const socialButtons = [];
            
            if (websites.length > 0) {
                socialButtons.push({ text: '🌐 Website', url: websites[0].url });
            }
            socials.forEach(s => {
                if (s.type === 'twitter' && socialButtons.length < 3) {
                    socialButtons.push({ text: '𝕏', url: s.url });
                }
                if (s.type === 'telegram' && socialButtons.length < 3) {
                    socialButtons.push({ text: '💬 TG', url: s.url });
                }
            });
            
            if (socialButtons.length > 0) {
                keyboard.inline_keyboard.push(socialButtons);
            }
        }
        
        await bot.editMessageText(summary, {
            chat_id: chatId,
            message_id: loadingMsg.message_id,
            parse_mode: 'MarkdownV2',
            reply_markup: keyboard,
            disable_web_page_preview: true
        });
        
        console.log(`✓ Scanned: ${tokenAddress} - ${scanData.riskLevel}`);
        
    } catch (error) {
        console.error(`✗ Error: ${error.message}`);
        await bot.editMessageText(`❌ Error: ${esc(error.message)}`, {
            chat_id: chatId,
            message_id: loadingMsg.message_id,
            parse_mode: 'MarkdownV2'
        });
    }
}

// ================================================================
// CALLBACK BUTTONS
// ================================================================

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    
    // Answer callback quickly to prevent timeout
    try {
        await bot.answerCallbackQuery(query.id);
    } catch (e) {
        // Ignore - query may have expired
    }
    
    if (data === 'help') {
        bot.sendMessage(chatId, `
*How to use:*

1\\. Paste a token contract address
2\\. Get instant summary
3\\. Click "Full Report" for details

*What I check:*
• Honeypot status
• Buy/Sell taxes
• Contract verification
• LP locks
• Holder concentration
• Market sentiment
        `, { parse_mode: 'MarkdownV2' });
        return;
    }
    
    // Full report
    if (data.startsWith('full_')) {
        const tokenAddress = data.replace('full_', '');
        const cacheKey = `${chatId}_${tokenAddress}`;
        const scanData = scanCache.get(cacheKey);
        
        if (!scanData) {
            await handleScan(chatId, tokenAddress, messageId);
            return;
        }
        
        try {
            const fullReport = formatFullReport(tokenAddress, scanData);
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '📊 Summary', callback_data: `summary_${tokenAddress}` },
                        { text: '🔄 Rescan', callback_data: `scan_${tokenAddress}` }
                    ],
                    [
                        { text: '📊 DexScreener', url: `https://dexscreener.com/ethereum/${tokenAddress}` },
                        { text: '🔍 Etherscan', url: `https://etherscan.io/token/${tokenAddress}` }
                    ]
                ]
            };
            
            // Telegram has 4096 char limit - split if needed
            if (fullReport.length > 4000) {
                // Delete original message
                await bot.deleteMessage(chatId, messageId);
                
                // Split into chunks
                const chunks = [];
                let current = '';
                const lines = fullReport.split('\n');
                
                for (const line of lines) {
                    if ((current + line + '\n').length > 3900) {
                        chunks.push(current);
                        current = line + '\n';
                    } else {
                        current += line + '\n';
                    }
                }
                if (current) chunks.push(current);
                
                // Send chunks
                for (let i = 0; i < chunks.length; i++) {
                    const isLast = i === chunks.length - 1;
                    await bot.sendMessage(chatId, chunks[i], {
                        parse_mode: 'MarkdownV2',
                        reply_markup: isLast ? keyboard : undefined,
                        disable_web_page_preview: true
                    });
                }
            } else {
                await bot.editMessageText(fullReport, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'MarkdownV2',
                    reply_markup: keyboard,
                    disable_web_page_preview: true
                });
            }
        } catch (error) {
            console.error('Full report error:', error.message);
            await bot.sendMessage(chatId, `❌ Error showing full report: ${esc(error.message)}`, {
                parse_mode: 'MarkdownV2'
            });
        }
        return;
    }
    
    // Back to summary
    if (data.startsWith('summary_')) {
        const tokenAddress = data.replace('summary_', '');
        const cacheKey = `${chatId}_${tokenAddress}`;
        const scanData = scanCache.get(cacheKey);
        
        if (!scanData) {
            await handleScan(chatId, tokenAddress, messageId);
            return;
        }
        
        const summary = formatSummary(tokenAddress, scanData);
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📋 Full Report', callback_data: `full_${tokenAddress}` },
                    { text: '🔄 Rescan', callback_data: `scan_${tokenAddress}` }
                ],
                [
                    { text: '📊 DexScreener', url: `https://dexscreener.com/ethereum/${tokenAddress}` },
                    { text: '🔍 Etherscan', url: `https://etherscan.io/token/${tokenAddress}` }
                ]
            ]
        };
        
        await bot.editMessageText(summary, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'MarkdownV2',
            reply_markup: keyboard,
            disable_web_page_preview: true
        });
        return;
    }
    
    // Rescan
    if (data.startsWith('scan_')) {
        const tokenAddress = data.replace('scan_', '');
        await handleScan(chatId, tokenAddress, messageId);
        return;
    }
});

// ================================================================
// MESSAGE HANDLER
// ================================================================

bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    
    const text = msg.text.trim();
    
    if (isValidAddress(text)) {
        await handleScan(msg.chat.id, text);
    }
});

console.log('Ready! Commands: /start, /help');
console.log('Or just paste a token address.\n');
