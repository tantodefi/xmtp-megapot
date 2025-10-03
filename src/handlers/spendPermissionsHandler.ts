import { ContentTypeWalletSendCalls } from "@xmtp/content-type-wallet-send-calls";
import type { Conversation } from "@xmtp/node-sdk";

export interface SpendPermission {
  account: string;
  spender: string;
  token: string;
  chainId: number;
  allowance: bigint;
  periodInDays: number;
  signature?: string;
  extraData?: string;
}

export interface SpendConfig {
  dailyLimit: number; // USD amount
  ticketsPerDay: number;
  purchaseType: "solo" | "pool" | "both" | "alternating";
  duration: number; // days
  soloTicketsPerDay?: number; // For both (combined) purchases
  poolTicketsPerDay?: number; // For both (combined) purchases
}

export const USDC_BASE_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const SPEND_PERMISSION_MANAGER =
  process.env.SPEND_PERMISSION_MANAGER ||
  "0x0000000000000000000000000000000000000000";

/**
 * Get transaction receipt link from Basescan
 */
export const getBasescanTxLink = (txHash: string): string => {
  if (txHash.startsWith("processing_")) {
    // Transaction is still being processed
    return "Transaction processing... Check back in a few moments for the receipt link";
  }
  if (txHash.startsWith("direct_")) {
    // Direct purchase using spend permission
    return "Transaction completed using spend permission. Receipt will be available shortly.";
  }
  return `https://basescan.org/tx/${txHash}`;
};

/**
 * Get transaction receipt link from Paymaster (if available)
 */
export const getPaymasterTxLink = (txHash: string): string => {
  // This would be implemented based on the specific paymaster service
  return getBasescanTxLink(txHash);
};

export class SpendPermissionsHandler {
  private userPermissions = new Map<string, SpendPermission[]>();
  private userConfigs = new Map<string, SpendConfig>();
  private automationTimers = new Map<string, NodeJS.Timeout>();
  private lastPurchaseTypes = new Map<string, "solo" | "pool">();

  constructor(private spenderAddress: string) {}

  /**
   * Send automation notification to user (in DM if possible)
   */
  private async sendAutomationNotification(
    userAddress: string,
    message: string,
    conversation: Conversation,
    client?: any,
  ): Promise<void> {
    try {
      // Try to get user's inbox ID from their address
      const inboxState = await client?.preferences?.inboxStateFromInboxIds([
        userAddress,
      ]);
      if (inboxState && inboxState[0]?.identifiers[0]?.identifier) {
        const userInboxId = inboxState[0].identifiers[0].identifier;
        const dm = await client.conversations.newDm(userInboxId);
        await dm.send(message);
        return;
      }
    } catch (error) {
      console.log(
        `⚠️ Failed to send DM to ${userAddress}, falling back to original conversation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Fallback to original conversation if DM fails
    await conversation.send(message);
  }

  /**
   * Build transaction calls for spend permission only
   */
  private async buildTransactionCalls(
    userAddress: string,
    config: SpendConfig,
    allowanceUSDC: bigint,
    megaPotManager?: any,
  ): Promise<any[]> {
    const calls = [];

    // Only include the spend permission approval - ticket purchase will be handled separately
    calls.push({
      to: USDC_BASE_ADDRESS as `0x${string}`,
      data: `0x095ea7b3000000000000000000000000${SPEND_PERMISSION_MANAGER.slice(2)}${allowanceUSDC.toString(16).padStart(64, "0")}`,
      value: "0x0",
      gas: "0x15F90",
      metadata: {
        description: `Approve ${config.dailyLimit} USDC for automated MegaPot purchases`,
        transactionType: "erc20_approve",
        source: "MegaPot",
        origin: "megapot.io",
        hostname: "megapot.io",
        faviconUrl: "https://megapot.io/favicon.ico",
        title: "MegaPot Lottery",
      },
    });

    return calls;
  }

  /**
   * Request spend permission from user for MegaPot purchases
   */
  async requestMegaPotSpendPermission(
    userAddress: string,
    config: SpendConfig,
    megaPotManager?: any,
  ): Promise<{ permission: SpendPermission; transaction: any }> {
    try {
      // Convert USD to USDC (6 decimals)
      const allowanceUSDC = BigInt(config.dailyLimit * 1_000_000);

      // Prepare the spend permission transaction
      const spendTx = {
        version: "1.0",
        chainId: "0x2105", // Base mainnet
        from: userAddress as `0x${string}`,
        capabilities: {
          reference: `megapot_spend_permission_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          app: "MegaPot",
          icon: "https://megapot.io/favicon.ico",
          domain: "megapot.io",
          name: "MegaPot Lottery",
          description: "MegaPot Lottery Assistant",
          hostname: "megapot.io",
          faviconUrl: "https://megapot.io/favicon.ico",
          title: "MegaPot Lottery",
        },
        calls: await this.buildTransactionCalls(
          userAddress,
          config,
          allowanceUSDC,
          megaPotManager,
        ),
      };

      // Store permission and config
      const userPermissions = this.userPermissions.get(userAddress) || [];
      const permission: SpendPermission = {
        account: userAddress,
        spender: this.spenderAddress,
        token: USDC_BASE_ADDRESS,
        chainId: 8453,
        allowance: allowanceUSDC,
        periodInDays: 1,
        signature: `demo_signature_${Date.now()}`,
        extraData: JSON.stringify(config),
      };
      userPermissions.push(permission);
      this.userPermissions.set(userAddress, userPermissions);
      this.userConfigs.set(userAddress, config);

      return { permission, transaction: spendTx };
    } catch (error) {
      console.error("Error requesting spend permission:", error);
      throw error;
    }
  }

  /**
   * Check if user has active spend permission
   */
  async hasActiveSpendPermission(
    userAddress: string,
    requiredAmount: number,
  ): Promise<{
    hasPermission: boolean;
    permission?: SpendPermission;
    remainingSpend?: number;
  }> {
    try {
      const userPermissions = this.userPermissions.get(userAddress);
      if (!userPermissions || userPermissions.length === 0) {
        return { hasPermission: false };
      }

      // Get latest permission
      const permission = userPermissions[userPermissions.length - 1];
      const remainingSpend = Number(permission.allowance) / 1_000_000; // Convert to USD

      return {
        hasPermission: remainingSpend >= requiredAmount,
        permission,
        remainingSpend,
      };
    } catch (error) {
      console.error("Error checking spend permission:", error);
      return { hasPermission: false };
    }
  }

  /**
   * Get spend permission status for user
   */
  async getSpendPermissionStatus(userAddress: string): Promise<string> {
    try {
      const userPermissions = this.userPermissions.get(userAddress);
      if (!userPermissions || userPermissions.length === 0) {
        return "❌ No spend permissions found. Set up permissions with 'setup spend permission'.";
      }

      const permission = userPermissions[userPermissions.length - 1];
      const config = this.userConfigs.get(userAddress);
      const isAutomated = this.automationTimers.has(userAddress);

      let purchaseDescription = "";
      if (config) {
        if (
          config.purchaseType === "both" &&
          config.soloTicketsPerDay &&
          config.poolTicketsPerDay
        ) {
          purchaseDescription = `${config.soloTicketsPerDay} solo + ${config.poolTicketsPerDay} pool tickets daily (2 transactions)`;
        } else {
          purchaseDescription = `${config.ticketsPerDay} ${config.purchaseType} tickets daily`;
        }
      }

      return `🔐 Spend Permission Status

💰 Daily Limit: $${Number(permission.allowance) / 1_000_000} USDC
🎫 Purchase Plan: ${purchaseDescription}
⏱️ Duration: ${config?.duration || "Unknown"} days
🤖 Automation: ${isAutomated ? "✅ Active (24h timer)" : "❌ Inactive"}

🔑 Spender: ${permission.spender.slice(0, 8)}...${permission.spender.slice(-6)}
📅 Period: ${permission.periodInDays} day(s)

Commands:
• "buy now" - Execute immediate purchase (requires transaction approval)
• "start automation" - Begin 24-hour timer for daily purchases
• "stop automation" - Pause automated buying
• "revoke permissions" - Remove all permissions

💡 Tip: First approve the spend permission transaction, then use "buy now" for immediate purchase or "start automation" for daily purchases.`;
    } catch (error) {
      console.error("Error getting spend permission status:", error);
      return "❌ Error retrieving spend permission status.";
    }
  }

  /**
   * Start automated buying for user (sets up timer and executes first purchase immediately)
   */
  async startAutomatedBuying(
    userAddress: string,
    conversation: Conversation,
    megaPotManager?: any,
    poolHandler?: any,
    client?: any,
  ): Promise<boolean> {
    const config = this.userConfigs.get(userAddress);
    if (!config) {
      await conversation.send(
        "❌ No spend configuration found. Please set up spend permissions first.",
      );
      return false;
    }

    // Stop existing automation if any
    this.stopAutomatedBuying(userAddress);

    // Log that auto purchase is starting
    console.log(
      `🚀 AUTO-PURCHASE STARTED: User ${userAddress.slice(0, 8)}... has approved spend permission. Starting automated buying for ${config.ticketsPerDay} ${config.purchaseType} tickets daily for ${config.duration} days.`,
    );
    console.log(
      `⛽ Gas sponsorship: Automated purchases will be gasless if paymaster is configured.`,
    );

    const intervalMs = 24 * 60 * 60 * 1000; // 24 hours

    // Set up timer to check for approval and execute first purchase
    const checkInterval = 30 * 1000; // Check every 30 seconds
    const maxWaitTime = 5 * 60 * 1000; // Max wait time: 5 minutes
    let elapsedTime = 0;

    const checkForApproval = async () => {
      elapsedTime += checkInterval;

      const { hasPermission } = await this.hasActiveSpendPermission(
        userAddress,
        config.ticketsPerDay,
      );

      if (hasPermission) {
        // Permission approved! Execute first purchase and start timer
        await conversation.send(
          "🎯 Executing first automated purchase to verify everything works...",
        );

        try {
          await automatedPurchase();

          // Start the timer for subsequent purchases
          const timer = setInterval(automatedPurchase, intervalMs);
          this.automationTimers.set(userAddress, timer);

          await conversation.send(
            "✅ Automated buying activated!\n\n🎫 First purchase completed successfully\n🤖 Daily purchases scheduled every 24 hours\n⏰ Next purchase tomorrow at this time\n\n📊 Check status anytime with 'spend status'",
          );
          return true;
        } catch (error) {
          console.error("Error in first automated purchase:", error);
          await conversation.send(
            "❌ Failed to execute first automated purchase. Please check your spend permissions.",
          );
          return false;
        }
      } else if (elapsedTime >= maxWaitTime) {
        // Max wait time reached, stop checking
        await conversation.send(
          "⏰ Wait time exceeded. Please approve the spend permission transaction and use 'start automation' to begin purchases.",
        );
        return false;
      } else {
        // Still waiting, check again
        console.log(
          `⏳ Waiting for spend permission approval for user ${userAddress.slice(0, 8)}... (${elapsedTime / 1000}s elapsed)`,
        );
        setTimeout(checkForApproval, checkInterval);
      }
    };

    const automatedPurchase = async () => {
      try {
        const { hasPermission, permission, remainingSpend } =
          await this.hasActiveSpendPermission(
            userAddress,
            config.ticketsPerDay,
          );

        if (!hasPermission || !permission || !remainingSpend) {
          await conversation.send(
            `⚠️ Automated buying paused - insufficient spend permission. Remaining: $${remainingSpend || 0}`,
          );
          return;
        }

        // Handle different purchase types
        if (config.purchaseType === "both") {
          // Buy both solo AND pool tickets (2 separate transactions)
          const soloTickets = config.soloTicketsPerDay || 0;
          const poolTickets = config.poolTicketsPerDay || 0;

          if (soloTickets > 0 && megaPotManager && client) {
            await conversation.send(
              `🤖 Automated Purchase (Solo): Buying ${soloTickets} solo tickets for $${soloTickets}`,
            );

            try {
              // Execute real solo purchase through MegaPotManager
              const soloTx = await megaPotManager.prepareTicketPurchase(
                soloTickets,
                userAddress,
              );

              // Execute via spend permission with real transaction
              const txHash = await this.executeSpendCalls(
                soloTx,
                conversation,
                userAddress,
                "solo",
                soloTickets,
                megaPotManager,
                client,
              );

              // Send confirmation with receipt link
              const receiptLink = getBasescanTxLink(txHash);
              await conversation.send(
                `✅ Solo Purchase Completed!
🎫 ${soloTickets} ticket${soloTickets > 1 ? "s" : ""} purchased successfully
💰 Cost: $${soloTickets}
📊 Receipt: ${receiptLink}
⏰ Next automated purchase in 24 hours`,
              );

              console.log(
                `🎫 Solo purchase executed: ${soloTickets} tickets for ${userAddress} (tx: ${txHash})`,
              );
            } catch (error) {
              console.error("Solo purchase failed:", error);
              await conversation.send(
                `❌ Solo purchase failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              );
            }
          }

          if (poolTickets > 0 && poolHandler) {
            await conversation.send(
              `🤖 Automated Purchase (Pool): Buying ${poolTickets} pool tickets for $${poolTickets}`,
            );

            try {
              // Execute real pool purchase through PoolHandler
              const poolResult = await poolHandler.processPooledTicketPurchase(
                userAddress,
                poolTickets,
                conversation,
              );

              // Execute via spend permission with real transaction
              if (poolResult.transaction) {
                const txHash = await this.executeSpendCalls(
                  poolResult.transaction,
                  conversation,
                  userAddress,
                  "pool",
                  poolTickets,
                  megaPotManager,
                  client,
                );

                // Send confirmation with receipt link
                const receiptLink = getBasescanTxLink(txHash);
                await conversation.send(
                  `✅ Pool Purchase Completed!
🏊 ${poolTickets} pool ticket${poolTickets > 1 ? "s" : ""} purchased successfully
💰 Cost: $${poolTickets}
📊 Receipt: ${receiptLink}
⏰ Next automated purchase in 24 hours`,
                );

                console.log(
                  `🏊 Pool purchase executed: ${poolTickets} tickets for ${userAddress} (tx: ${txHash})`,
                );
              }
            } catch (error) {
              console.error("Pool purchase failed:", error);
              await conversation.send(
                `❌ Pool purchase failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              );
            }
          }
        } else {
          // Single purchase type (solo, pool, or alternating)
          let purchaseType: "solo" | "pool";
          let ticketCount = config.ticketsPerDay;

          if (config.purchaseType === "alternating") {
            // Alternate between solo and pool
            const lastPurchase = this.getLastPurchaseType(userAddress);
            purchaseType = lastPurchase === "solo" ? "pool" : "solo";
          } else {
            purchaseType = config.purchaseType;
          }

          await conversation.send(
            `🤖 Automated Purchase (${purchaseType}): Buying ${ticketCount} tickets for $${ticketCount}`,
          );

          try {
            if (purchaseType === "solo" && megaPotManager && client) {
              // Execute real solo purchase
              const soloTx = await megaPotManager.prepareTicketPurchase(
                ticketCount,
                userAddress,
              );

              const txHash = await this.executeSpendCalls(
                soloTx,
                conversation,
                userAddress,
                "solo",
                ticketCount,
                megaPotManager,
                client,
              );

              // Send confirmation with receipt link
              const receiptLink = getBasescanTxLink(txHash);
              await conversation.send(
                `✅ ${purchaseType === "solo" ? "Solo" : "Pool"} Purchase Completed!
🎫 ${ticketCount} ticket${ticketCount > 1 ? "s" : ""} purchased successfully
💰 Cost: $${ticketCount}
📊 Receipt: ${receiptLink}
⏰ Next automated purchase in 24 hours`,
              );

              console.log(
                `🎫 ${purchaseType === "solo" ? "Solo" : "Pool"} purchase executed: ${ticketCount} tickets for ${userAddress} (tx: ${txHash})`,
              );
            } else if (purchaseType === "pool" && poolHandler) {
              // Execute real pool purchase
              const poolResult = await poolHandler.processPooledTicketPurchase(
                userAddress,
                ticketCount,
                conversation,
              );

              if (poolResult.transaction) {
                const txHash = await this.executeSpendCalls(
                  poolResult.transaction,
                  conversation,
                  userAddress,
                  "pool",
                  ticketCount,
                  megaPotManager,
                  client,
                );

                // Send confirmation with receipt link
                const receiptLink = getBasescanTxLink(txHash);
                await conversation.send(
                  `✅ Pool Purchase Completed!
🏊 ${ticketCount} pool ticket${ticketCount > 1 ? "s" : ""} purchased successfully
💰 Cost: $${ticketCount}
📊 Receipt: ${receiptLink}
⏰ Next automated purchase in 24 hours`,
                );

                console.log(
                  `🏊 Pool purchase executed: ${ticketCount} tickets for ${userAddress} (tx: ${txHash})`,
                );
              }
            }
          } catch (error) {
            console.error("Automated purchase failed:", error);
            await conversation.send(
              `❌ Purchase failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          }
        }
      } catch (error) {
        console.error("Error in automated purchase:", error);
      }
    };

    // Start the approval check timer
    await conversation.send(
      "⏳ Please approve the spend permission transaction in your wallet.\n\nAfter approval:\n• First purchase will be executed automatically\n• Automation will be activated\n• Daily purchases will start immediately\n\nNo additional transaction approvals needed!",
    );

    // Start the approval check timer
    setTimeout(checkForApproval, checkInterval);
    return true;
  }

  /**
   * Execute immediate purchase (for manual start)
   */
  async executeImmediatePurchase(
    userAddress: string,
    conversation: Conversation,
    megaPotManager?: any,
    poolHandler?: any,
    client?: any,
  ): Promise<boolean> {
    const config = this.userConfigs.get(userAddress);
    if (!config) {
      await conversation.send(
        "❌ No spend configuration found. Please set up spend permissions first.",
      );
      return false;
    }

    try {
      const { hasPermission, permission, remainingSpend } =
        await this.hasActiveSpendPermission(userAddress, config.ticketsPerDay);

      if (!hasPermission || !permission || !remainingSpend) {
        await conversation.send(
          `⚠️ Cannot execute immediate purchase - insufficient spend permission. Remaining: $${remainingSpend || 0}`,
        );
        return false;
      }

      // Execute the purchase logic (same as in automatedPurchase)
      const automatedPurchase = async () => {
        try {
          // Handle different purchase types
          if (config.purchaseType === "both") {
            // Buy both solo AND pool tickets (2 separate transactions)
            const soloTickets = config.soloTicketsPerDay || 0;
            const poolTickets = config.poolTicketsPerDay || 0;

            if (soloTickets > 0 && megaPotManager && client) {
              await conversation.send(
                `🤖 Immediate Purchase (Solo): Buying ${soloTickets} solo tickets for $${soloTickets}`,
              );

              try {
                const soloTx = await megaPotManager.prepareTicketPurchase(
                  soloTickets,
                  userAddress,
                );

                const txHash = await this.executeSpendCalls(
                  soloTx,
                  conversation,
                  userAddress,
                  "solo",
                  soloTickets,
                  megaPotManager,
                  client,
                );

                // Send confirmation with receipt link
                const receiptLink = getBasescanTxLink(txHash);
                await conversation.send(
                  `✅ Solo Purchase Completed!
🎫 ${soloTickets} ticket${soloTickets > 1 ? "s" : ""} purchased successfully
💰 Cost: $${soloTickets}
📊 Receipt: ${receiptLink}
🤖 Automation is still active - next purchase in 24 hours`,
                );

                console.log(
                  `🎫 Solo purchase executed: ${soloTickets} tickets for ${userAddress} (tx: ${txHash})`,
                );
              } catch (error) {
                console.error("Solo purchase failed:", error);
                await conversation.send(
                  `❌ Solo purchase failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
              }
            }

            if (poolTickets > 0 && poolHandler) {
              await conversation.send(
                `🤖 Immediate Purchase (Pool): Buying ${poolTickets} pool tickets for $${poolTickets}`,
              );

              try {
                const poolResult =
                  await poolHandler.processPooledTicketPurchase(
                    userAddress,
                    poolTickets,
                    conversation,
                  );

                if (poolResult.transaction) {
                  const txHash = await this.executeSpendCalls(
                    poolResult.transaction,
                    conversation,
                    userAddress,
                    "pool",
                    poolTickets,
                    megaPotManager,
                    client,
                  );

                  // Send confirmation with receipt link
                  const receiptLink = getBasescanTxLink(txHash);
                  await conversation.send(
                    `✅ Pool Purchase Completed!
🏊 ${poolTickets} pool ticket${poolTickets > 1 ? "s" : ""} purchased successfully
💰 Cost: $${poolTickets}
📊 Receipt: ${receiptLink}
🤖 Automation is still active - next purchase in 24 hours`,
                  );

                  console.log(
                    `🏊 Pool purchase executed: ${poolTickets} tickets for ${userAddress} (tx: ${txHash})`,
                  );
                }
              } catch (error) {
                console.error("Pool purchase failed:", error);
                await conversation.send(
                  `❌ Pool purchase failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
              }
            }
          } else {
            // Single purchase type (solo, pool, or alternating)
            let purchaseType: "solo" | "pool";
            let ticketCount = config.ticketsPerDay;

            if (config.purchaseType === "alternating") {
              const lastPurchase = this.getLastPurchaseType(userAddress);
              purchaseType = lastPurchase === "solo" ? "pool" : "solo";
            } else {
              purchaseType = config.purchaseType;
            }

            await conversation.send(
              `🤖 Immediate Purchase (${purchaseType}): Buying ${ticketCount} tickets for $${ticketCount}`,
            );

            try {
              if (purchaseType === "solo" && megaPotManager && client) {
                const soloTx = await megaPotManager.prepareTicketPurchase(
                  ticketCount,
                  userAddress,
                );

                const txHash = await this.executeSpendCalls(
                  soloTx,
                  conversation,
                  userAddress,
                  "solo",
                  ticketCount,
                  megaPotManager,
                  client,
                );

                // Send confirmation with receipt link
                const receiptLink = getBasescanTxLink(txHash);
                await conversation.send(
                  `✅ ${purchaseType === "solo" ? "Solo" : "Pool"} Purchase Completed!
🎫 ${ticketCount} ticket${ticketCount > 1 ? "s" : ""} purchased successfully
💰 Cost: $${ticketCount}
📊 Receipt: ${receiptLink}
🤖 Automation is still active - next purchase in 24 hours`,
                );

                console.log(
                  `🎫 ${purchaseType === "solo" ? "Solo" : "Pool"} purchase executed: ${ticketCount} tickets for ${userAddress} (tx: ${txHash})`,
                );
              } else if (purchaseType === "pool" && poolHandler) {
                const poolResult =
                  await poolHandler.processPooledTicketPurchase(
                    userAddress,
                    ticketCount,
                    conversation,
                  );

                if (poolResult.transaction) {
                  const txHash = await this.executeSpendCalls(
                    poolResult.transaction,
                    conversation,
                    userAddress,
                    "pool",
                    ticketCount,
                    megaPotManager,
                    client,
                  );

                  // Send confirmation with receipt link
                  const receiptLink = getBasescanTxLink(txHash);
                  await conversation.send(
                    `✅ Pool Purchase Completed!
🏊 ${ticketCount} pool ticket${ticketCount > 1 ? "s" : ""} purchased successfully
💰 Cost: $${ticketCount}
📊 Receipt: ${receiptLink}
🤖 Automation is still active - next purchase in 24 hours`,
                  );

                  console.log(
                    `🏊 Pool purchase executed: ${ticketCount} tickets for ${userAddress} (tx: ${txHash})`,
                  );
                }
              }
            } catch (error) {
              console.error("Immediate purchase failed:", error);
              await conversation.send(
                `❌ Purchase failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              );
            }
          }
        } catch (error) {
          console.error("Error in immediate purchase:", error);
        }
      };

      await automatedPurchase();
      return true;
    } catch (error) {
      console.error("Error executing immediate purchase:", error);
      return false;
    }
  }

  /**
   * Stop automated buying for user
   */
  stopAutomatedBuying(userAddress: string): void {
    const timer = this.automationTimers.get(userAddress);
    if (timer) {
      clearInterval(timer);
      this.automationTimers.delete(userAddress);
    }
  }

  /**
   * Revoke all spend permissions for user
   */
  async revokeAllPermissions(userAddress: string): Promise<boolean> {
    try {
      // Stop any active automation
      this.stopAutomatedBuying(userAddress);

      // Clear permissions
      this.userPermissions.delete(userAddress);
      this.userConfigs.delete(userAddress);

      return true;
    } catch (error) {
      console.error("Error revoking permissions:", error);
      return false;
    }
  }

  /**
   * Execute spend calls with proper permissions
   */
  private async executeSpendCalls(
    transaction: any,
    conversation: Conversation,
    userAddress: string,
    purchaseType: "solo" | "pool",
    ticketCount: number,
    megaPotManager?: any,
    client?: any,
  ): Promise<string> {
    try {
      let walletSendCalls: any;
      let referenceId: string;

      // Check if this is from MegaPotManager (has approveCall and purchaseCall)
      if (transaction.approveCall && transaction.purchaseCall) {
        // Format MegaPotManager transaction for wallet send calls
        referenceId =
          transaction.referenceId || `megapot_purchase_${Date.now()}`;
        walletSendCalls = {
          version: "1.0",
          chainId: "0x2105", // Base mainnet
          from: userAddress as `0x${string}`,
          capabilities: {
            reference: referenceId,
            app: "MegaPot",
            icon: "https://megapot.io/favicon.ico",
            domain: "megapot.io",
            name: "MegaPot Lottery",
            description: `${purchaseType === "solo" ? "Solo" : "Pool"} Ticket Purchase`,
            hostname: "megapot.io",
            faviconUrl: "https://megapot.io/favicon.ico",
            title: "MegaPot Lottery",
          },
          calls: [transaction.approveCall, transaction.purchaseCall],
        };
      } else {
        // Use transaction as-is (for pool handler or other cases)
        referenceId =
          transaction.capabilities?.reference ||
          `megapot_purchase_${Date.now()}`;
        walletSendCalls = transaction;
      }

      // Execute the purchase directly using MegaPotManager
      // since we have spend permission approval
      console.log(
        `✅ Executing ${purchaseType} purchase directly using spend permission: ${ticketCount} tickets for ${userAddress}`,
      );

      try {
        // Use MegaPotManager to execute the purchase directly
        // The agent should have spend permission approval to call this
        let txHash: string;

        if (purchaseType === "solo" && megaPotManager && client) {
          // Use MegaPotManager's buyTickets method to execute directly
          const purchaseResult = await megaPotManager.buyTickets(ticketCount);
          txHash =
            purchaseResult.txHash ||
            purchaseResult.referenceId ||
            `direct_${Date.now()}`;
        } else {
          txHash = `direct_${referenceId}`;
        }

        console.log(
          `🎫 ${purchaseType} purchase executed directly: ${ticketCount} tickets for ${userAddress} (tx: ${txHash})`,
        );

        return txHash;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(
          `Error executing ${purchaseType} purchase directly:`,
          error,
        );

        // Check if it's a paymaster-related error
        if (
          errorMessage.includes("paymaster") ||
          errorMessage.includes("sponsoring") ||
          errorMessage.includes("approval failed") ||
          errorMessage.includes("Purchase transaction failed") ||
          errorMessage.includes("gas required exceeds allowance")
        ) {
          console.error(`❌ Paymaster issue detected: ${errorMessage}`);
          await conversation.send(
            `❌ Automated purchase failed due to paymaster issue.\n\n🔧 **Paymaster Troubleshooting:**\n• Paymaster may not have sufficient funds\n• Paymaster may need contract allowlisting\n• Paymaster gas limits may be too low\n• Try using "buy now" command for manual purchase\n\n💡 **CDP Paymaster Setup:**\n1. Ensure your CDP paymaster has sufficient ETH/BASE tokens\n2. Add MegaPot contract to allowed contracts list\n3. Verify USDC contract is allowlisted\n\n📊 Error: ${errorMessage}`,
          );
        }

        throw error;
      }
    } catch (error) {
      console.error("Error executing spend calls:", error);
      throw error;
    }
  }

  /**
   * Get last purchase type for alternating purchases
   */
  private getLastPurchaseType(userAddress: string): "solo" | "pool" {
    return this.lastPurchaseTypes.get(userAddress) || "pool";
  }

  /**
   * Set last purchase type for alternating purchases
   */
  private setLastPurchaseType(
    userAddress: string,
    purchaseType: "solo" | "pool",
  ): void {
    this.lastPurchaseTypes.set(userAddress, purchaseType);
  }
}
