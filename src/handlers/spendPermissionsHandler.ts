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

export class SpendPermissionsHandler {
  private userPermissions = new Map<string, SpendPermission[]>();
  private userConfigs = new Map<string, SpendConfig>();
  private automationTimers = new Map<string, NodeJS.Timeout>();

  constructor(private spenderAddress: string) {}

  /**
   * Request spend permission from user for MegaPot purchases
   */
  async requestMegaPotSpendPermission(
    userAddress: string,
    config: SpendConfig,
  ): Promise<SpendPermission> {
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
        calls: [
          {
            to: SPEND_PERMISSION_MANAGER as `0x${string}`,
            data: "0x095ea7b300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
            value: "0x0",
            gas: "0xC350",
            metadata: {
              description: `Set up spend permission for ${config.dailyLimit} USDC per day`,
              transactionType: "spend_permission",
              source: "MegaPot",
              origin: "megapot.io",
              hostname: "megapot.io",
              faviconUrl: "https://megapot.io/favicon.ico",
              title: "MegaPot Lottery",
            },
          },
          {
            to: USDC_BASE_ADDRESS as `0x${string}`,
            data: "0x095ea7b300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
            value: "0x0",
            gas: "0xC350",
            metadata: {
              description: `Approve USDC spending for ${config.dailyLimit} USDC per day`,
              transactionType: "erc20_approve",
              source: "MegaPot",
              origin: "megapot.io",
              hostname: "megapot.io",
              faviconUrl: "https://megapot.io/favicon.ico",
              title: "MegaPot Lottery",
            },
          },
        ],
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

      return permission;
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
🤖 Automation: ${isAutomated ? "✅ Active" : "❌ Inactive"}

🔑 Spender: ${permission.spender.slice(0, 8)}...${permission.spender.slice(-6)}
📅 Period: ${permission.periodInDays} day(s)

Commands:
• "start automation" - Begin daily purchases
• "stop automation" - Pause automated buying
• "revoke permissions" - Remove all permissions`;
    } catch (error) {
      console.error("Error getting spend permission status:", error);
      return "❌ Error retrieving spend permission status.";
    }
  }

  /**
   * Start automated buying for user
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

    const intervalMs = 24 * 60 * 60 * 1000; // 24 hours

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
              const soloTx = await megaPotManager.preparePurchaseTransaction(
                userAddress,
                soloTickets,
                conversation,
                client,
              );

              // Execute via spend permission with real transaction
              await this.executeSpendCalls(
                soloTx,
                conversation,
                userAddress,
                "solo",
                soloTickets,
              );

              console.log(
                `🎫 Solo purchase executed: ${soloTickets} tickets for ${userAddress}`,
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
                await this.executeSpendCalls(
                  poolResult.transaction,
                  conversation,
                  userAddress,
                  "pool",
                  poolTickets,
                );
              }

              console.log(
                `🏊 Pool purchase executed: ${poolTickets} tickets for ${userAddress}`,
              );
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
              const soloTx = await megaPotManager.preparePurchaseTransaction(
                userAddress,
                ticketCount,
                conversation,
                client,
              );

              await this.executeSpendCalls(
                soloTx,
                conversation,
                userAddress,
                "solo",
                ticketCount,
              );

              console.log(
                `🎫 Solo purchase executed: ${ticketCount} tickets for ${userAddress}`,
              );
            } else if (purchaseType === "pool" && poolHandler) {
              // Execute real pool purchase
              const poolResult = await poolHandler.processPooledTicketPurchase(
                userAddress,
                ticketCount,
                conversation,
              );

              if (poolResult.transaction) {
                await this.executeSpendCalls(
                  poolResult.transaction,
                  conversation,
                  userAddress,
                  "pool",
                  ticketCount,
                );
              }

              console.log(
                `🏊 Pool purchase executed: ${ticketCount} tickets for ${userAddress}`,
              );
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

    // Start the timer
    const timer = setInterval(automatedPurchase, intervalMs);
    this.automationTimers.set(userAddress, timer);

    // Execute first purchase immediately
    await automatedPurchase();

    await conversation.send(
      "✅ Automated buying started! I'll execute purchases daily at this time.",
    );
    return true;
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
  ): Promise<void> {
    try {
      // Send the transaction to user's wallet
      await conversation.send(transaction, ContentTypeWalletSendCalls);

      // Store purchase type for alternating purchases
      this.setLastPurchaseType(userAddress, purchaseType);

      console.log(
        `✅ ${purchaseType} purchase transaction sent: ${ticketCount} tickets for ${userAddress}`,
      );
    } catch (error) {
      console.error("Error executing spend calls:", error);
      throw error;
    }
  }

  /**
   * Get last purchase type for alternating purchases
   */
  private getLastPurchaseType(userAddress: string): "solo" | "pool" {
    const key = `lastPurchaseType_${userAddress}`;
    return (localStorage.getItem(key) as "solo" | "pool") || "pool";
  }

  /**
   * Set last purchase type for alternating purchases
   */
  private setLastPurchaseType(
    userAddress: string,
    purchaseType: "solo" | "pool",
  ): void {
    const key = `lastPurchaseType_${userAddress}`;
    localStorage.setItem(key, purchaseType);
  }
}
