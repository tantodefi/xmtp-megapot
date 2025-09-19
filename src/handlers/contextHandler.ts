import { Group } from "@xmtp/node-sdk";

export interface ConversationContext {
  conversationId: string;
  userInboxId: string;
  userAddress?: string;
  currentFlow?: "ticket_purchase" | "pool_purchase" | "stats_inquiry" | null;
  pendingTicketCount?: number;
  pendingPoolTicketCount?: number;
  lastInteractionTime: Date;
  awaitingConfirmation?: boolean;
  confirmationMessage?: string;
  isGroupChat: boolean;
  lastIntent?: string;
  intentConfidence?: number;
}

export class ContextHandler {
  private contexts = new Map<string, ConversationContext>();
  private readonly CONTEXT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Get or create conversation context
   */
  getContext(
    conversationId: string,
    userInboxId: string,
    isGroupChat: boolean = false,
  ): ConversationContext {
    const contextKey = `${conversationId}_${userInboxId}`;
    let context = this.contexts.get(contextKey);

    if (!context) {
      context = {
        conversationId,
        userInboxId,
        currentFlow: null,
        lastInteractionTime: new Date(),
        isGroupChat,
      };
      this.contexts.set(contextKey, context);
    }

    // Update last interaction time
    context.lastInteractionTime = new Date();
    return context;
  }

  /**
   * Update conversation context
   */
  updateContext(
    conversationId: string,
    userInboxId: string,
    updates: Partial<ConversationContext>,
  ): void {
    const contextKey = `${conversationId}_${userInboxId}`;
    const context = this.contexts.get(contextKey);

    if (context) {
      Object.assign(context, updates, { lastInteractionTime: new Date() });
    }
  }

  /**
   * Set pending ticket purchase context
   */
  setPendingTicketPurchase(
    conversationId: string,
    userInboxId: string,
    ticketCount: number,
    userAddress: string,
    isGroupChat: boolean = false,
  ): void {
    const context = this.getContext(conversationId, userInboxId, isGroupChat);
    context.currentFlow = "ticket_purchase";
    context.pendingTicketCount = ticketCount;
    context.userAddress = userAddress;
    context.awaitingConfirmation = true;
    context.confirmationMessage = `purchase ${ticketCount} ticket${ticketCount > 1 ? "s" : ""} for $${ticketCount} USDC`;
  }

  /**
   * Set pending pool ticket purchase context
   */
  setPendingPoolPurchase(
    conversationId: string,
    userInboxId: string,
    ticketCount: number,
    userAddress: string,
  ): void {
    const context = this.getContext(conversationId, userInboxId, true);
    context.currentFlow = "pool_purchase";
    context.pendingPoolTicketCount = ticketCount;
    context.userAddress = userAddress;
    context.awaitingConfirmation = true;
    context.confirmationMessage = `purchase ${ticketCount} ticket${ticketCount > 1 ? "s" : ""} for the group pool for $${ticketCount} USDC`;
  }

  /**
   * Check if user has pending confirmation
   */
  hasPendingConfirmation(conversationId: string, userInboxId: string): boolean {
    const contextKey = `${conversationId}_${userInboxId}`;
    const context = this.contexts.get(contextKey);
    return context?.awaitingConfirmation === true;
  }

  /**
   * Get pending confirmation details
   */
  getPendingConfirmation(
    conversationId: string,
    userInboxId: string,
  ): {
    ticketCount?: number;
    poolTicketCount?: number;
    flow?: string;
    message?: string;
    userAddress?: string;
  } | null {
    const contextKey = `${conversationId}_${userInboxId}`;
    const context = this.contexts.get(contextKey);

    if (!context?.awaitingConfirmation) {
      return null;
    }

    return {
      ticketCount: context.pendingTicketCount,
      poolTicketCount: context.pendingPoolTicketCount,
      flow: context.currentFlow || undefined,
      message: context.confirmationMessage,
      userAddress: context.userAddress,
    };
  }

  /**
   * Clear pending confirmation
   */
  clearPendingConfirmation(conversationId: string, userInboxId: string): void {
    const contextKey = `${conversationId}_${userInboxId}`;
    const context = this.contexts.get(contextKey);

    if (context) {
      context.awaitingConfirmation = false;
      context.pendingTicketCount = undefined;
      context.pendingPoolTicketCount = undefined;
      context.confirmationMessage = undefined;
      context.currentFlow = null;
    }
  }

  /**
   * Check if message is likely a confirmation
   */
  isConfirmationMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase().trim();
    const confirmationWords = [
      "yes",
      "yeah",
      "yep",
      "y",
      "sure",
      "ok",
      "okay",
      "confirm",
      "approve",
      "proceed",
      "go ahead",
      "continue",
      "do it",
      "buy",
      "purchase",
      "continue with purchase",
      "go for it",
      "let's do it",
      "sounds good",
    ];

    return confirmationWords.some(
      (word) => lowerMessage === word || lowerMessage.includes(word),
    );
  }

  /**
   * Check if message is likely a cancellation
   */
  isCancellationMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase().trim();
    const cancellationWords = [
      "no",
      "nope",
      "cancel",
      "stop",
      "nevermind",
      "never mind",
      "abort",
      "quit",
      "exit",
      "back",
      "not now",
      "maybe later",
    ];

    return cancellationWords.some(
      (word) => lowerMessage === word || lowerMessage.includes(word),
    );
  }

  /**
   * Update last intent for context
   */
  updateLastIntent(
    conversationId: string,
    userInboxId: string,
    intent: string,
    confidence: number,
  ): void {
    const contextKey = `${conversationId}_${userInboxId}`;
    const context = this.contexts.get(contextKey);

    if (context) {
      context.lastIntent = intent;
      context.intentConfidence = confidence;
    }
  }

  /**
   * Get conversation flow context for AI prompting
   */
  getFlowContext(conversationId: string, userInboxId: string): string {
    const contextKey = `${conversationId}_${userInboxId}`;
    const context = this.contexts.get(contextKey);

    if (!context) {
      return "";
    }

    if (context.awaitingConfirmation && context.confirmationMessage) {
      return `\n\nCONVERSATION CONTEXT: User is in the middle of a ticket purchase flow. They were asked to confirm: "${context.confirmationMessage}". If they confirm (yes/approve/continue), proceed with the transaction. If they provide a number, they might be specifying ticket quantity.`;
    }

    if (context.currentFlow === "ticket_purchase") {
      return `\n\nCONVERSATION CONTEXT: User is in a ticket purchase flow. Look for ticket quantities or confirmation messages.`;
    }

    if (context.currentFlow === "pool_purchase") {
      return `\n\nCONVERSATION CONTEXT: User is in a group pool purchase flow. Look for ticket quantities or confirmation messages for group purchases.`;
    }

    if (
      context.lastIntent &&
      context.intentConfidence &&
      context.intentConfidence > 0.7
    ) {
      return `\n\nCONVERSATION CONTEXT: User's last intent was "${context.lastIntent}" with high confidence. Consider this context for interpreting their current message.`;
    }

    return "";
  }

  /**
   * Cleanup expired contexts
   */
  cleanupExpiredContexts(): void {
    const now = new Date();
    const expiredKeys: string[] = [];

    for (const [key, context] of this.contexts.entries()) {
      const timeDiff = now.getTime() - context.lastInteractionTime.getTime();
      if (timeDiff > this.CONTEXT_TIMEOUT_MS) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.contexts.delete(key);
    }

    if (expiredKeys.length > 0) {
      console.log(
        `🧹 Cleaned up ${expiredKeys.length} expired conversation contexts`,
      );
    }
  }

  /**
   * Get context summary for debugging
   */
  getContextSummary(conversationId: string, userInboxId: string): string {
    const contextKey = `${conversationId}_${userInboxId}`;
    const context = this.contexts.get(contextKey);

    if (!context) {
      return "No active context";
    }

    return `Flow: ${context.currentFlow || "none"}, Pending: ${context.awaitingConfirmation ? "yes" : "no"}, Tickets: ${context.pendingTicketCount || "none"}, Pool: ${context.pendingPoolTicketCount || "none"}`;
  }
}
