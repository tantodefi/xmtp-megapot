import OpenAI from "openai";
import { MegaPotManager } from "../managers/MegaPotManager.js";
import {
  getDisplayName,
  getPersonalizedGreeting,
} from "../utils/displayName.js";
import { ContextHandler } from "./contextHandler.js";

export interface MessageIntent {
  type:
    | "buy_tickets"
    | "check_stats"
    | "jackpot_info"
    | "claim_winnings"
    | "help"
    | "greeting"
    | "general_inquiry"
    | "pooled_purchase"
    | "confirmation"
    | "cancellation"
    | "setup_spend_permission"
    | "spend_permission_status"
    | "start_automation"
    | "stop_automation"
    | "revoke_permissions"
    | "spend_config_input"
    | "buy_now"
    | "unknown";
  confidence: number;
  extractedData?: {
    ticketCount?: number;
    amount?: number;
    pooledRequest?: boolean;
    askForQuantity?: boolean;
    askForPurchaseType?: boolean;
    isConfirmation?: boolean;
    isCancellation?: boolean;
    clearIntent?: boolean;
    configText?: string;
    duration?: number;
    purchaseType?: "solo" | "pool";
    recipientUsername?: string;
    targetUsername?: string;
    buyForEveryone?: boolean;
  };
  response: string;
}

export class SmartHandler {
  private openai: OpenAI;
  private megaPotManager: MegaPotManager;
  private contextHandler: ContextHandler;

  constructor(openaiApiKey: string, megaPotManager: MegaPotManager) {
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.megaPotManager = megaPotManager;
    this.contextHandler = new ContextHandler();

    // Cleanup expired contexts every 5 minutes
    setInterval(
      () => {
        this.contextHandler.cleanupExpiredContexts();
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Get the context handler instance
   */
  getContextHandler(): ContextHandler {
    return this.contextHandler;
  }

  /**
   * Generate explanation of solo vs pool tickets with stats
   */
  async generateTicketTypeExplanation(
    userAddress?: string,
    isGroupChat: boolean = false,
  ): Promise<string> {
    try {
      const lotteryStats = await this.megaPotManager.getStats(userAddress);
      const allTimeStats = await this.fetchAllTimeStats();

      const soloSection = `🎫 Solo Tickets (Individual Purchase)
• You keep 100% of any winnings
• Direct purchase from your wallet
• Immediate ownership and control
• Current price: $${lotteryStats.ticketPrice || "1.00"} USDC per ticket
• Your solo tickets: ${lotteryStats.individualTicketsPurchased || 0}`;

      const poolSection = isGroupChat
        ? `
👥 Pool Tickets (Group Purchase)
• Increases your group's chances of winning
• Share costs and winnings proportionally based on risk exposure
• Collective buying power for larger ticket volumes
• Same ticket price: $${lotteryStats.ticketPrice || "1.00"} USDC per ticket
• Your pool contributions: ${lotteryStats.groupTicketsPurchased || 0} tickets

📊 Pool Benefits:
• Higher winning chances through volume
• Proportional prize sharing based on contribution
• Social lottery experience with friends
• Automatic payout distribution`
        : `
👥 Pool Tickets (Group Purchase)
• Only available in group chats
• Increases group's chances of winning
• Share costs and winnings with group members
• Join a group conversation to access pool purchases`;

      const statsSection = `
📈 Current Round Stats:
• Jackpot: $${lotteryStats.jackpotPool || "0"}
• Total tickets sold: ${lotteryStats.ticketsSoldRound || 0}
• Your total tickets: ${lotteryStats.totalTicketsPurchased || 0}
• Your winning odds: 1 in ${lotteryStats.userOdds || "∞"}

🏆 All-Time Performance:
• Total jackpots won: $${allTimeStats?.JackpotsRunTotal_USD?.toLocaleString() || "179M+"}
• Lucky winners: ${allTimeStats?.total_won || "19"} players
• Total tickets sold: ${allTimeStats?.total_tickets?.toLocaleString() || "282K+"}`;

      return `${soloSection}${poolSection}${statsSection}

💡 Which should you choose?
• Solo: Maximum control and 100% winnings
• Pool: Higher chances through volume, shared winnings

🎰 Ready to play? Use the action buttons below!`;
    } catch (error) {
      console.error("Error generating ticket type explanation:", error);
      return `🎫 Solo vs Pool Tickets

Solo Tickets: You buy individually and keep all winnings
Pool Tickets: Group members share costs and winnings, increasing collective chances

Both types cost $1 USDC per ticket. Choose based on your preference for individual control vs. shared experience!`;
    }
  }

  /**
   * Parse user message using LLM and determine intent with contextual response
   */
  async parseMessageIntent(
    message: string,
    userAddress?: string,
    isGroupChat: boolean = false,
    conversationId?: string,
    userInboxId?: string,
  ): Promise<MessageIntent> {
    try {
      // Check for conversation context first
      let conversationContext = "";
      if (conversationId && userInboxId) {
        conversationContext = this.contextHandler.getFlowContext(
          conversationId,
          userInboxId,
        );

        // Check for confirmation/cancellation in context
        if (
          this.contextHandler.hasPendingConfirmation(
            conversationId,
            userInboxId,
          )
        ) {
          if (this.contextHandler.isConfirmationMessage(message)) {
            const pendingConfirmation =
              this.contextHandler.getPendingConfirmation(
                conversationId,
                userInboxId,
              );
            return {
              type: "confirmation",
              confidence: 0.95,
              extractedData: {
                isConfirmation: true,
                ticketCount:
                  pendingConfirmation?.ticketCount ||
                  pendingConfirmation?.poolTicketCount,
                pooledRequest: pendingConfirmation?.flow === "pool_purchase",
              },
              response: `Perfect! Proceeding with your ${pendingConfirmation?.message || "purchase"}...`,
            };
          } else if (this.contextHandler.isCancellationMessage(message)) {
            return {
              type: "cancellation",
              confidence: 0.95,
              extractedData: { isCancellation: true },
              response:
                "No problem! Your purchase has been cancelled. Let me know if you'd like to try something else.",
            };
          }
        }
      }

      // For simple greetings, skip expensive API calls to improve response time
      const isSimpleGreeting = /^(gm|good morning|hello|hi|hey)$/i.test(
        message.trim(),
      );

      let lotteryStats = null;
      let allTimeStats = null;

      if (!isSimpleGreeting) {
        // Only fetch data for non-greeting messages to improve performance
        lotteryStats = await this.megaPotManager.getStats(userAddress);
        allTimeStats = await this.fetchAllTimeStats();
      }

      // Create context for the LLM
      const contextPrompt = this.buildContextPrompt(
        lotteryStats,
        allTimeStats,
        isGroupChat,
        conversationContext,
      );

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: contextPrompt,
          },
          {
            role: "user",
            content: message,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const response =
        completion.choices[0]?.message?.content ||
        "I'm here to help with LottoBot! Try asking about buying tickets, checking stats, or jackpot info.";

      // Parse the LLM response to extract intent and data
      const intent = this.extractIntentFromResponse(
        message,
        conversationId || "",
        userInboxId || "",
      );

      // Update context with the detected intent (but preserve standalone_number context)
      if (conversationId && userInboxId) {
        const currentContext = this.contextHandler.getContext(
          conversationId,
          userInboxId,
        );

        // Don't overwrite lastIntent if we're in a solo/pool choice flow
        if (
          currentContext?.lastIntent !== "standalone_number" ||
          (intent.type !== "buy_tickets" && intent.type !== "pooled_purchase")
        ) {
          this.contextHandler.updateLastIntent(
            conversationId,
            userInboxId,
            intent.type,
            intent.confidence,
          );
        } else {
          console.log(
            `🔒 Preserving standalone_number context, not updating to ${intent.type}`,
          );
        }
      }

      // intent already includes response from extractIntentFromResponse
      return intent;
    } catch (error) {
      console.error("❌ Error parsing message intent:", error);

      // Fallback to rule-based parsing
      return this.fallbackIntentParsing(message);
    }
  }

  /**
   * Build context prompt for the LLM with current lottery data
   */
  private buildContextPrompt(
    lotteryStats: any,
    allTimeStats: any,
    isGroupChat: boolean,
    conversationContext: string = "",
  ): string {
    const groupChatInfo = isGroupChat
      ? "\n- This is a GROUP CHAT. Users can buy POOL TICKETS together to increase their collective chances of winning."
      : "\n- This is a DIRECT MESSAGE conversation.";

    return `You are LottoBot (@lottobot.base.eth), an AI assistant for a lottery system on Base blockchain. Your role is to:

1. ANALYZE user messages and determine their intent
2. PROVIDE helpful, concise responses (max 2-3 sentences)
3. GUIDE users toward appropriate actions
4. EXTRACT numerical data when users mention ticket quantities

CURRENT LOTTERY DATA:
${
  lotteryStats
    ? `- Jackpot: $${lotteryStats.jackpotPool || "0"}
- Ticket Price: $${lotteryStats.ticketPrice || "1.00"} USDC
- Tickets Sold: ${lotteryStats.ticketsSoldRound || 0}
- Active Players: ${lotteryStats.activePlayers || 0}
- User's Total Tickets: ${lotteryStats.totalTicketsPurchased || 0}
- User's Spending: ${lotteryStats.totalSpent || "$0"}`
    : "- Data will be fetched when needed for specific requests"
}

ALL-TIME STATS:
${
  allTimeStats
    ? `- Total Jackpots: $${allTimeStats?.JackpotsRunTotal_USD?.toLocaleString() || "179,816,793"}
- Total Players: ${allTimeStats?.total_players?.toLocaleString() || "14,418"}
- Total Tickets: ${allTimeStats?.total_tickets?.toLocaleString() || "282,495"}
- Total Winners: ${allTimeStats?.total_won || "19"}`
    : "- Stats available on request"
}

${groupChatInfo}

RESPONSE RULES:
- Keep responses SHORT and actionable (2-3 sentences max)
- For ticket purchases, ALWAYS extract or infer the number and confirm the action
- If user says "buy me a ticket" (singular), assume 1 ticket
- If user gives just a number in ticket context, use that number
- For stats requests, provide relevant current data
- For jackpot inquiries, give current pool and ticket price
- For greetings, welcome them and show key actions
- For pooled purchases in groups, explain how they increase winning chances through volume
- Always end with a clear next step or action button reference

INTENT CATEGORIES:
- buy_tickets: User wants to purchase tickets (ALWAYS extract or infer quantity)
- check_stats: User wants to see their statistics
- jackpot_info: User wants jackpot/prize information  
- claim_winnings: User wants to claim prizes
- help: User needs assistance or commands
- greeting: User says hello/hi/gm
- pooled_purchase: User mentions group/pool/together ticket buying
- general_inquiry: Questions about lottery mechanics
- confirmation: User is confirming a pending action (yes/approve/continue)
- cancellation: User is cancelling a pending action (no/cancel/stop)
- unknown: Unclear intent

IMPORTANT: For buy_tickets intent, you MUST extract or infer the ticket quantity:
- "buy me a ticket" = 1 ticket
- "buy tickets" = ask how many
- "buy 5 tickets" = 5 tickets
- "5 tickets" = 5 tickets (standalone)
- Just "7" in ticket context = 7 tickets
- "seven" or other word numbers = convert to digits

CRITICAL: If user provides a number followed by "tickets" or "ticket", this is ALWAYS a buy_tickets intent, even without the word "buy".

BUY TICKETS: When user wants to buy tickets with explicit "buy" or "tickets" words, provide minimal response like "👍". For standalone numbers (like "5" or "five"), provide NO RESPONSE - let the main handler ask for solo/pool choice.

POOL TICKETS: When user mentions "pool tickets", detect as pooled_purchase intent. Provide minimal response like "👍" or "Processing..." - the main handler will send the detailed message.

CONTEXT AWARENESS:
- Pay attention to conversation flow and pending confirmations
- If user says "yes", "approve", "continue" after being asked to confirm a purchase, treat as confirmation
- If user provides just a number after being asked "how many tickets", use that number
- Maintain conversational continuity and don't repeat information unnecessarily

${conversationContext}

Respond naturally but concisely, and I'll handle the specific actions.`;
  }

  /**
   * Extract intent from LLM response
   */
  private extractIntentFromResponse(
    originalMessage: string,
    conversationId?: string,
    userInboxId?: string,
  ): MessageIntent {
    const lowerMessage = originalMessage.toLowerCase();

    // Check for spend permission patterns FIRST (highest priority)
    const spendConfigPattern =
      /\$?\d+\$?.*(?:day|daily|every\s+day).*\d+\s*days?/i;
    const buyTicketsPattern = /buy\s+\d+.*(?:ticket|for).*\d+\s*days?/i;
    const ticketsPerDayPattern =
      /\d+.*ticket.*(?:day|daily|every\s+day).*(?:for|next).*\d+\s*days?/i;
    const automatedBuyingPattern =
      /buy.*(?:ticket|solo|pool).*(?:day|daily|every\s+day).*\d+\s*days?/i;
    const dailyTicketPattern =
      /(?:buy|get)\s+(?:a|one|\d+)\s+(?:solo|pool)?\s*tickets?\s+(?:a\s+)?(?:day|daily|every\s+day)\s+for\s+\d+\s*days?/i;
    const scheduledBuyPattern =
      /(?:buy|get)\s+(?:a|one|\d+)\s+(?:solo|pool)?\s*tickets?\s+(?:for|over|next|the\s+next)\s+\d+\s*days?/i;
    const dollarAmountPattern =
      /\$?\d+\$?\s*(?:every\s+day|per\s+day|daily)\s+for\s+\d+\s*days?/i;

    // Check for requests to force other users to buy tickets (should be rejected)
    const forceOtherUserPattern =
      /have\s+@\w+\s+buy|make\s+@\w+\s+buy|force\s+@\w+\s+to\s+buy|tell\s+@\w+\s+to\s+buy/i;
    if (forceOtherUserPattern.test(lowerMessage)) {
      console.log(
        `🚫 BLOCKED: Request to force other user to buy tickets: "${originalMessage}"`,
      );
      return {
        type: "unknown",
        confidence: 0.9,
        response:
          "❌ I cannot force other users to spend their money or buy tickets on their behalf. Each user must initiate their own ticket purchases using their own wallet and funds.",
      };
    }

    // Check for buying tickets for everyone in group
    const buyForEveryonePattern =
      /buy.*ticket.*(?:for\s+everyone|for\s+all|for\s+each\s+member|for\s+each\s+person)/i;
    if (buyForEveryonePattern.test(lowerMessage)) {
      console.log(
        `👥 DETECTED: Buy tickets for everyone: "${originalMessage}"`,
      );
      const ticketMatch = lowerMessage.match(/buy\s+(\d+)/i) || ["", "1"];
      const ticketCount = parseInt(ticketMatch[1]) || 1;

      // Get member count from context
      const context =
        conversationId && userInboxId
          ? this.contextHandler.getContext(conversationId, userInboxId)
          : null;
      const memberCount = context?.groupMemberCount || 0;

      // If member count is 0, we need to fetch it from the conversation
      if (memberCount === 0) {
        console.log(
          `🔄 No member count in context, fetching from conversation...`,
        );
        // TODO: Fetch member count from conversation and update context
      }

      // Calculate total cost
      const totalCost = ticketCount * memberCount;

      return {
        type: "buy_tickets",
        confidence: 0.95,
        extractedData: {
          ticketCount,
          clearIntent: true,
          buyForEveryone: true,
        },
        response: `👥 Preparing group purchase:
• ${ticketCount} ticket${ticketCount > 1 ? "s" : ""} per member
• Cost: $${ticketCount}.00 USDC per person
• Members: ${memberCount} total
• Total cost: $${totalCost}.00 USDC

✅ Open your wallet to approve this batch transaction. Each member will receive their own tickets!`,
      };
    }

    // Check for buying tickets for other users (as recipient)
    const buyForOtherPattern = /buy\s+(\d+).*ticket.*for\s+@(\w+)/i;
    const buyForOtherMatch = lowerMessage.match(buyForOtherPattern);
    if (buyForOtherMatch) {
      console.log(
        `🎁 DETECTED: Buy tickets for other user: "${originalMessage}"`,
      );
      const ticketCount = parseInt(buyForOtherMatch[1]) || 1;
      const recipientUsername = buyForOtherMatch[2];

      return {
        type: "buy_tickets",
        confidence: 0.95,
        extractedData: {
          ticketCount,
          clearIntent: true,
          recipientUsername,
        },
        response: `🎁 Buying ${ticketCount} ticket${ticketCount > 1 ? "s" : ""} for @${recipientUsername}`,
      };
    }

    // Check for showing stats for other users
    const showStatsForOtherPattern = /show\s+stats\s+for\s+@\w+/i;
    if (showStatsForOtherPattern.test(lowerMessage)) {
      console.log(
        `📊 DETECTED: Show stats for other user: "${originalMessage}"`,
      );
      const targetMatch = lowerMessage.match(/for\s+@(\w+)/i);

      if (targetMatch) {
        const targetUsername = targetMatch[1];

        return {
          type: "check_stats",
          confidence: 0.95,
          extractedData: {
            targetUsername,
          },
          response: `📊 Getting stats for @${targetUsername}...`,
        };
      }
    }

    // Check for spend permission patterns first
    if (
      spendConfigPattern.test(lowerMessage) ||
      buyTicketsPattern.test(lowerMessage) ||
      ticketsPerDayPattern.test(lowerMessage) ||
      automatedBuyingPattern.test(lowerMessage) ||
      dailyTicketPattern.test(lowerMessage) ||
      scheduledBuyPattern.test(lowerMessage) ||
      dollarAmountPattern.test(lowerMessage)
    ) {
      // Extract ticket count and duration
      const ticketMatch = lowerMessage.match(
        /(?:a|one|\d+)\s+(?:solo|pool)?\s*tickets?/i,
      );
      const durationMatch = lowerMessage.match(/(?:for\s+)?(\d+)\s*days?/i);
      const purchaseType = lowerMessage.includes("pool") ? "pool" : "solo";

      const ticketCount = ticketMatch
        ? ticketMatch[0].match(/\d+/)
          ? parseInt(ticketMatch[0])
          : 1
        : 1;
      const duration = durationMatch ? parseInt(durationMatch[1]) : 1;

      console.log(
        `🔐 SPEND PERMISSION DETECTED: "${originalMessage}" -> ${ticketCount} ${purchaseType} tickets for ${duration} days`,
      );

      return {
        type: "setup_spend_permission",
        confidence: 0.95,
        extractedData: {
          configText: originalMessage,
          ticketCount,
          duration,
          purchaseType,
        },
        response: `🔐 Setting up spend permissions for ${ticketCount} ${purchaseType} tickets per day for ${duration} days...`,
      };
    }

    // Check for context-aware confirmation/cancellation
    if (conversationId && userInboxId) {
      const hasPending = this.contextHandler.hasPendingConfirmation(
        conversationId,
        userInboxId,
      );

      if (hasPending) {
        // Only treat simple confirmation words as confirmations, NOT ticket purchase requests
        const isSimpleConfirmation =
          /^(yes|yeah|yep|ok|okay|confirm|proceed|continue|approve)$/i.test(
            originalMessage.trim(),
          );
        const isSimpleCancellation =
          /^(no|nope|cancel|stop|abort|nevermind)$/i.test(
            originalMessage.trim(),
          );

        if (isSimpleConfirmation) {
          const pendingConfirmation =
            this.contextHandler.getPendingConfirmation(
              conversationId,
              userInboxId,
            );
          return {
            type: "confirmation",
            confidence: 0.95,
            extractedData: {
              isConfirmation: true,
              ticketCount:
                pendingConfirmation?.ticketCount ||
                pendingConfirmation?.poolTicketCount,
              pooledRequest: pendingConfirmation?.flow === "pool_purchase",
            },
            response: `Perfect! Proceeding with your ${pendingConfirmation?.message || "purchase"}...`,
          };
        } else if (isSimpleCancellation) {
          return {
            type: "cancellation",
            confidence: 0.95,
            extractedData: { isCancellation: true },
            response:
              "No problem! Your purchase has been cancelled. Let me know if you'd like to try something else.",
          };
        } else {
          // If there's a pending purchase but this isn't a simple confirmation/cancellation,
          // treat it as a new purchase request and clear the old context
          console.log(
            `🔄 Clearing old pending context for new purchase request: "${originalMessage}"`,
          );
          this.contextHandler.clearPendingConfirmation(
            conversationId,
            userInboxId,
          );
        }
      }
    }

    // Enhanced ticket number extraction - more comprehensive patterns
    const ticketPatterns = [
      /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)\s*tickets?/i,
      /(give\s+me|get\s+me|want)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*tickets?/i,
      /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*tickets?/i,
      /tickets?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i,
      /^(\d+)\s*tickets?$/i, // Match standalone "5 tickets"
      /^(\d+)\s*ticket$/i, // Match standalone "5 ticket"
    ];

    let ticketCount: number | undefined;

    // Try multiple patterns to extract ticket count
    for (const pattern of ticketPatterns) {
      const match = originalMessage.match(pattern);
      if (match) {
        const ticketStr = match[1] || match[2];
        if (ticketStr) {
          ticketCount = this.parseNumberFromText(ticketStr);
          if (ticketCount) break;
        }
      }
    }

    // Also try standalone numbers in ticket context
    if (!ticketCount) {
      const numberMatch = originalMessage.match(/\b(\d+)\b/);
      if (numberMatch) {
        const number = parseInt(numberMatch[1]);
        // If it's a reasonable ticket number (1-100), use it
        if (number >= 1 && number <= 100) {
          ticketCount = number;
        }
      }
    }

    // Special case: if user says "a ticket" or "me a ticket", default to 1
    if (!ticketCount && /\b(a|me\s+a)\s+ticket\b/i.test(originalMessage)) {
      ticketCount = 1;
    }

    // Enhanced intent detection with better patterns
    const buyPatterns = [
      /\b(buy|purchase|get|want|give\s+me)\b.*\b(ticket|five|ten|two|three|four|six|seven|eight|nine|\d+)/i,
      /\b(ticket|five|ten|two|three|four|six|seven|eight|nine|\d+)\b.*\b(buy|purchase|get|want)/i,
      /^\d+\s*tickets?$/i, // Match standalone "5 tickets"
      /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*tickets?$/i, // Match word numbers
    ];

    let isBuyIntent = false;
    for (const pattern of buyPatterns) {
      if (pattern.test(originalMessage)) {
        isBuyIntent = true;
        break;
      }
    }

    // Don't automatically set isBuyIntent based on ticket count alone
    // Let pool detection happen first

    // Try to extract ticket count from message if not found yet
    if (!ticketCount) {
      const ticketMatch = originalMessage
        .toLowerCase()
        .match(/(\d+)\s*tickets?/i);
      if (ticketMatch) {
        const parsedCount = parseInt(ticketMatch[1]);
        if (parsedCount >= 1 && parsedCount <= 100) {
          ticketCount = parsedCount;
        }
      }
    }

    // Check for solo/pool one-word responses in purchase flow
    if (
      (lowerMessage === "solo" || lowerMessage === "pool") &&
      conversationId &&
      userInboxId
    ) {
      const context = this.contextHandler.getContext(
        conversationId,
        userInboxId,
      );
      if (context?.pendingTicketCount) {
        return {
          type: "buy_tickets",
          confidence: 0.95,
          extractedData: {
            ticketCount: context.pendingTicketCount,
            clearIntent: true,
            purchaseType: lowerMessage as "solo" | "pool",
          },
          response: `🎫 Preparing to buy ${context.pendingTicketCount} ${lowerMessage} ticket${context.pendingTicketCount > 1 ? "s" : ""}...`,
        };
      }
    }

    // Check for explicit solo purchase (clear intent - no confirmation needed)
    const hasSoloKeywords =
      lowerMessage.includes("solo") || lowerMessage.includes("individual");
    if (hasSoloKeywords && (isBuyIntent || lowerMessage.includes("ticket"))) {
      return {
        type: "buy_tickets",
        confidence: 0.95,
        extractedData: {
          ticketCount,
          clearIntent: true, // Skip confirmation for clear intent
        },
        response: `🎫 Preparing to buy ${ticketCount || 1} solo ticket${(ticketCount || 1) > 1 ? "s" : ""}...`,
      };
    }

    // SECOND: Check for explicit pool purchase (clear intent - no confirmation needed)
    const poolKeywords = ["pool", "group", "together", "shared", "collective"];

    const hasPoolContext = poolKeywords.some((keyword) =>
      lowerMessage.includes(keyword),
    );

    if (hasPoolContext && (isBuyIntent || lowerMessage.includes("ticket"))) {
      return {
        type: "pooled_purchase",
        confidence: 0.95,
        extractedData: {
          pooledRequest: true,
          ticketCount,
          clearIntent: true, // Skip confirmation for clear intent
        },
        response: `🎯 Preparing to buy ${ticketCount || 1} pool ticket${(ticketCount || 1) > 1 ? "s" : ""} for the group...`,
      };
    }

    // THIRD: Check for ambiguous buy tickets (needs solo/pool choice)
    if (
      isBuyIntent ||
      (lowerMessage.includes("buy") &&
        (lowerMessage.includes("ticket") || ticketCount))
    ) {
      // If no ticket count found but singular "ticket", default to 1
      if (
        !ticketCount &&
        /\bticket\b/.test(lowerMessage) &&
        !/\btickets\b/.test(lowerMessage)
      ) {
        ticketCount = 1;
      }

      return {
        type: "buy_tickets",
        confidence: 0.9,
        extractedData: {
          ticketCount,
          askForPurchaseType: true, // Need to ask solo or pool
        },
        response: "", // Let the main handler handle the response
      };
    }

    // Check for spend permission status (before check_stats to give it priority)
    if (
      (lowerMessage.includes("spend") ||
        lowerMessage.includes("permission") ||
        lowerMessage.includes("automation")) &&
      (lowerMessage.includes("status") ||
        lowerMessage.includes("info") ||
        lowerMessage.includes("check"))
    ) {
      return {
        type: "spend_permission_status",
        confidence: 0.9,
        response: "📋 Checking your spend permission status...",
      };
    }

    if (
      lowerMessage.includes("stat") ||
      (lowerMessage.includes("ticket") && lowerMessage.includes("my"))
    ) {
      return {
        type: "check_stats",
        confidence: 0.8,
        response: "📊 Fetching your lottery statistics...",
      };
    }

    if (
      lowerMessage.includes("jackpot") ||
      lowerMessage.includes("prize") ||
      lowerMessage.includes("pot")
    ) {
      return {
        type: "jackpot_info",
        confidence: 0.8,
        response: "🎰 Fetching current jackpot information...",
      };
    }

    if (lowerMessage.includes("claim") || lowerMessage.includes("winning")) {
      return {
        type: "claim_winnings",
        confidence: 0.8,
        response: "💰 Checking for winnings to claim...",
      };
    }

    if (lowerMessage.includes("help") || lowerMessage.includes("command")) {
      return {
        type: "help",
        confidence: 0.9,
        response: "❓ Showing help information...",
      };
    }

    if (
      lowerMessage.includes("hi") ||
      lowerMessage.includes("hello") ||
      lowerMessage.includes("gm") ||
      lowerMessage.includes("hey") ||
      lowerMessage.includes("whaddup") ||
      lowerMessage.includes("sup")
    ) {
      return {
        type: "greeting",
        confidence: 0.9,
        response: `👋 Welcome to LottoBot! I'm your AI-powered lottery assistant (@lottobot.base.eth).

🎫 Two ways to buy tickets:
• Solo tickets: Buy individually and keep 100% of winnings
  ex: 'buy 5 solo tickets'
• Pool tickets: Join group purchases to increase winning chances
  ex: 'buy 5 pool tickets'

📊 Key features:
• Check your stats and ticket history
• View current jackpot and odds
• Set up automated purchases
• Buy tickets for everyone in group chat

🌐 Try our full experience: https://frame.megapot.io/?referral=c7m8NL7l

Use the action buttons below to get started!`,
      };
    }

    if (
      lowerMessage.includes("how") ||
      lowerMessage.includes("what") ||
      lowerMessage.includes("?")
    ) {
      // Check if this is a question about solo vs pool tickets
      const context =
        conversationId && userInboxId
          ? this.contextHandler.getContext(conversationId, userInboxId)
          : null;
      const isAskingAboutTicketTypes =
        context?.lastIntent === "standalone_number" ||
        context?.pendingTicketCount;

      if (isAskingAboutTicketTypes) {
        return {
          type: "general_inquiry",
          confidence: 0.9,
          response: `🎫 Solo vs Pool Tickets:

• Solo tickets: Buy individually and keep 100% of any winnings
• Pool tickets: Join group purchases to share costs and increase winning chances

Reply 'solo' or 'pool' to continue with your purchase.`,
        };
      }

      return {
        type: "general_inquiry",
        confidence: 0.7,
        response: "🤔 I understand your question. Let me help clarify...",
      };
    }

    // Special case: user claims to be in group chat
    if (
      lowerMessage.includes("group chat") ||
      lowerMessage.includes("this is a group")
    ) {
      return {
        type: "general_inquiry",
        confidence: 0.8,
        response: "🔍 Analyzing conversation type...",
      };
    }

    // Handle solo/pool choice responses
    if (/^(solo|individual)$/i.test(originalMessage.trim())) {
      return {
        type: "buy_tickets",
        confidence: 0.9,
        response: "🎫 Solo purchase selected. Preparing transaction...",
      };
    }
    if (/^(pool|group)$/i.test(originalMessage.trim())) {
      return {
        type: "pooled_purchase",
        confidence: 0.9,
        response: "🎯 Pool purchase selected. Preparing group transaction...",
      };
    }

    // Check for spend permissions setup
    if (
      (lowerMessage.includes("setup") || lowerMessage.includes("create")) &&
      (lowerMessage.includes("spend") ||
        lowerMessage.includes("permission") ||
        lowerMessage.includes("automation"))
    ) {
      return {
        type: "setup_spend_permission",
        confidence: 0.9,
        response: "🔐 Setting up automated spending permissions...",
      };
    }

    // Check for immediate purchase
    if (
      lowerMessage.includes("buy now") ||
      lowerMessage.includes("purchase now") ||
      lowerMessage.includes("execute purchase")
    ) {
      return {
        type: "buy_now",
        confidence: 0.95,
        response: "⚡ Executing immediate purchase...",
      };
    }

    // Check for automation control
    if (
      lowerMessage.includes("start automation") ||
      lowerMessage.includes("begin automation")
    ) {
      return {
        type: "start_automation",
        confidence: 0.95,
        response: "🤖 Starting automated purchases...",
      };
    }

    if (
      lowerMessage.includes("stop automation") ||
      lowerMessage.includes("pause automation")
    ) {
      return {
        type: "stop_automation",
        confidence: 0.95,
        response: "⏸️ Stopping automated purchases...",
      };
    }

    // Check for revoke permissions
    if (
      (lowerMessage.includes("revoke") ||
        lowerMessage.includes("remove") ||
        lowerMessage.includes("cancel")) &&
      (lowerMessage.includes("permission") || lowerMessage.includes("spend"))
    ) {
      return {
        type: "revoke_permissions",
        confidence: 0.9,
        response: "🗑️ Revoking spend permissions...",
      };
    }

    // Duplicate patterns removed - now handled at the top

    return {
      type: "unknown",
      confidence: 0.3,
      response:
        "🤖 I'm not sure how to help with that. Try asking about buying tickets, checking stats, or jackpot info.",
    };
  }

  /**
   * Format response based on intent type
   */
  private async formatResponse(
    response: string,
    intentType: string,
    lotteryStats: any,
    userAddress?: string,
  ): Promise<string> {
    // For most intents, just return the AI response without adding extra information
    // The main handler will add specific details only when needed for transactions
    switch (intentType) {
      case "greeting":
        if (userAddress) {
          const personalizedGreeting =
            await getPersonalizedGreeting(userAddress);
          return `${personalizedGreeting} Welcome to LottoBot (@lottobot.base.eth)! You can buy tickets, check your stats, or inquire about the jackpot. What would you like to do today?\n\n🌐 Try the full experience: https://frame.megapot.io/?referral=c7m8NL7l`;
        }
        return `${response}\n\n🌐 Try the full experience: https://frame.megapot.io/?referral=c7m8NL7l`;

      default:
        // Don't add extra information - let the AI response stand alone
        return response;
    }
  }

  /**
   * Fallback intent parsing using rule-based approach
   */
  private fallbackIntentParsing(message: string): MessageIntent {
    const lowerMessage = message.toLowerCase();

    // Check for buying tickets for others
    const buyForOtherMatch = message.match(/@(\w+)\s+buy.*ticket/i);
    if (buyForOtherMatch) {
      return {
        type: "unknown",
        confidence: 0.8,
        response:
          "❌ Sorry, I can't force other users to buy tickets. They need to approve their own transactions.",
      };
    }

    // Check for buying tickets for recipient
    const buyForRecipientMatch = message.match(/buy.*ticket.*for\s+@(\w+)/i);
    if (buyForRecipientMatch) {
      const recipientUsername = buyForRecipientMatch[1];
      return {
        type: "buy_tickets",
        confidence: 0.8,
        response: `🎫 Would you like to buy solo or pool tickets for @${recipientUsername}? (just reply 'solo' or 'pool')`,
        extractedData: {
          ticketCount: 1,
          askForPurchaseType: true,
          recipientUsername,
        },
      };
    }

    // Check for showing stats for others
    const showStatsForMatch = message.match(
      /(?:show|check|get).*stats.*for\s+@(\w+)/i,
    );
    if (showStatsForMatch) {
      const targetUsername = showStatsForMatch[1];
      return {
        type: "check_stats",
        confidence: 0.9,
        response: `📊 Fetching lottery statistics for @${targetUsername}...`,
        extractedData: { targetUsername },
      };
    }

    // Enhanced patterns for ticket purchases
    const ticketPurchasePatterns = [
      /\b(buy|purchase|get|want|give\s+me)\b.*\b(ticket|five|ten|two|three|four|six|seven|eight|nine|\d+)/i,
      /\b(five|ten|two|three|four|six|seven|eight|nine)\s+tickets?/i,
      /\btickets?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i,
      /(\d+)\s*tickets?/i,
      /^(\d+)\s*tickets?$/i, // Match standalone "5 tickets"
      /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*tickets?$/i, // Match word numbers
    ];

    let ticketCount: number | undefined;
    let isBuyIntent = false;

    // Check for ticket purchase patterns
    for (const pattern of ticketPurchasePatterns) {
      const match = message.match(pattern);
      if (match) {
        isBuyIntent = true;
        // Extract number from match
        const numberStr = match[1] || match[2];
        if (numberStr) {
          const parsedCount = this.parseNumberFromText(numberStr);
          if (parsedCount) {
            ticketCount = parsedCount;
          }
        }
        break;
      }
    }

    // Check for standalone numbers that could be ticket counts
    if (!isBuyIntent) {
      const standaloneNumber = message.match(/^\s*(\d+)\s*$/);
      if (standaloneNumber) {
        const number = parseInt(standaloneNumber[1]);
        if (number >= 1 && number <= 100) {
          isBuyIntent = true;
          ticketCount = number;
        }
      }
    }

    // Also check for standalone word numbers that imply tickets
    if (!isBuyIntent) {
      const wordNumbers = [
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
      ];

      // Check if message is just a word number (in ticket context)
      for (const word of wordNumbers) {
        if (lowerMessage.trim() === word) {
          // Standalone word number - treat as ticket count
          isBuyIntent = true;
          ticketCount = this.parseNumberFromText(word);
          break;
        } else if (
          lowerMessage.includes(word) &&
          (lowerMessage.includes("ticket") ||
            lowerMessage.includes("buy") ||
            lowerMessage.includes("get") ||
            lowerMessage.includes("want"))
        ) {
          isBuyIntent = true;
          ticketCount = this.parseNumberFromText(word);
          break;
        }
      }
    }

    // Special case: "a ticket" or "me a ticket" defaults to 1
    if (!isBuyIntent && /\b(a|me\s+a)\s+ticket\b/i.test(message)) {
      isBuyIntent = true;
      ticketCount = 1;
    }

    // Check for pool context BEFORE returning buy_tickets
    const poolKeywords = ["pool", "group", "together", "shared", "collective"];
    const hasPoolContext = poolKeywords.some((keyword) =>
      lowerMessage.includes(keyword),
    );

    if (hasPoolContext && (isBuyIntent || ticketCount)) {
      return {
        type: "pooled_purchase",
        confidence: 0.8,
        response:
          "🎫 Would you like to buy solo or pool tickets? (just reply 'solo' or 'pool')",
        extractedData: {
          pooledRequest: true,
          ticketCount,
          askForPurchaseType:
            !lowerMessage.includes("pool") && !lowerMessage.includes("group"),
        },
      };
    }

    if (isBuyIntent) {
      return {
        type: "buy_tickets",
        confidence: 0.8,
        response:
          "🎫 Would you like to buy solo or pool tickets? (just reply 'solo' or 'pool')",
        extractedData: {
          ticketCount: ticketCount || 1,
          askForPurchaseType: true,
        },
      };
    }

    // Check for spend permission status (before check_stats to give it priority)
    if (
      (lowerMessage.includes("spend") ||
        lowerMessage.includes("permission") ||
        lowerMessage.includes("automation")) &&
      (lowerMessage.includes("status") ||
        lowerMessage.includes("info") ||
        lowerMessage.includes("check"))
    ) {
      return {
        type: "spend_permission_status",
        confidence: 0.9,
        response: "📋 Checking your spend permission status...",
      };
    }

    if (lowerMessage.includes("stat") || lowerMessage.includes("my")) {
      return {
        type: "check_stats",
        confidence: 0.7,
        response: "🎰 Fetching current jackpot information...",
      };
    }

    if (lowerMessage.includes("jackpot") || lowerMessage.includes("prize")) {
      return {
        type: "jackpot_info",
        confidence: 0.7,
        response: "🎰 Fetching current jackpot information...",
      };
    }

    if (lowerMessage.includes("help")) {
      return {
        type: "help",
        confidence: 0.8,
        response:
          "👋 Welcome to LottoBot (@lottobot.base.eth)! Quick guide:\n• Solo tickets: 'buy 5 solo tickets'\n• Pool tickets: 'buy 5 pool tickets'\n• Check stats: 'show my stats'\n• Current jackpot: 'show jackpot'",
      };
    }

    if (
      lowerMessage.includes("gm") ||
      lowerMessage.includes("hello") ||
      lowerMessage.includes("hi") ||
      lowerMessage.includes("whaddup")
    ) {
      return {
        type: "greeting",
        confidence: 0.8,
        response: `👋 Welcome to LottoBot! I'm your AI-powered lottery assistant (@lottobot.base.eth).

🎫 Two ways to buy tickets:
• Solo tickets: Buy individually and keep 100% of winnings
  ex: 'buy 5 solo tickets'
• Pool tickets: Join group purchases to increase winning chances
  ex: 'buy 5 pool tickets'

📊 Key features:
• Check your stats and ticket history
• View current jackpot and odds
• Set up automated purchases
• Buy tickets for everyone in group chat

🌐 Try our full experience: https://frame.megapot.io/?referral=c7m8NL7l

Use the action buttons below to get started!`,
      };
    }

    // Handle "yes" responses to ticket purchase questions
    if (
      lowerMessage === "yes" ||
      lowerMessage === "yeah" ||
      lowerMessage === "sure" ||
      lowerMessage === "yep" ||
      lowerMessage === "y"
    ) {
      return {
        type: "buy_tickets",
        confidence: 0.9,
        extractedData: {
          askForQuantity: true,
          askForPurchaseType: true,
        },
        response:
          "🎫 How many tickets would you like to purchase? (e.g., '5 tickets')",
      };
    }

    // Handle numeric words as standalone ticket counts
    const numericWords = [
      "twenty",
      "thirty",
      "forty",
      "fifty",
      "sixty",
      "seventy",
      "eighty",
      "ninety",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
      "eleven",
      "twelve",
      "thirteen",
      "fourteen",
      "fifteen",
      "sixteen",
      "seventeen",
      "eighteen",
      "nineteen",
    ];

    if (numericWords.includes(lowerMessage)) {
      const parsedTicketCount = this.parseNumberFromText(lowerMessage);
      if (parsedTicketCount) {
        return {
          type: "buy_tickets",
          confidence: 0.9,
          extractedData: { ticketCount: parsedTicketCount },
          response: `🎫 Preparing to buy ${parsedTicketCount} ticket${parsedTicketCount > 1 ? "s" : ""}...`,
        };
      }
    }

    return {
      type: "unknown",
      confidence: 0.5,
      response:
        "🤖 I'm not sure how to help with that. Try asking about buying tickets, checking stats, or jackpot info.",
    };
  }

  /**
   * Parse number from text (including word numbers)
   */
  private parseNumberFromText(text: string): number | undefined {
    const wordToNumber: { [key: string]: number } = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
      thirteen: 13,
      fourteen: 14,
      fifteen: 15,
      sixteen: 16,
      seventeen: 17,
      eighteen: 18,
      nineteen: 19,
      twenty: 20,
      thirty: 30,
      forty: 40,
      fifty: 50,
    };

    const lowerText = text.toLowerCase().trim();
    if (wordToNumber[lowerText]) {
      return wordToNumber[lowerText];
    }

    const parsed = parseInt(text);
    return isNaN(parsed) ? undefined : parsed;
  }

  /**
   * Fetch all-time stats from the new API endpoint
   */
  private async fetchAllTimeStats(): Promise<any> {
    try {
      const response = await fetch(
        "https://api.megapot.io/api/v1/all-time-stats?apikey=7no84S4VwcXViFPjReUM",
      );
      if (response.ok) {
        const data = await response.json();
        return data.data;
      }
    } catch (error) {
      console.error("Failed to fetch all-time stats:", error);
    }

    // Return fallback data
    return {
      JackpotsRunTotal_USD: 179816793,
      total_players: 14418,
      total_tickets: 282495,
      total_won: 19,
    };
  }

  /**
   * Generate contextual help response based on current lottery state
   */
  async generateContextualHelp(
    userAddress?: string,
    isGroupChat: boolean = false,
  ): Promise<string> {
    try {
      const lotteryStats = await this.megaPotManager.getStats(userAddress);
      const allTimeStats = await this.fetchAllTimeStats();

      const groupInfo = isGroupChat
        ? `

👥 Group Chat Features:
• "buy X tickets for group pool" - Pool purchases with shared winnings
• "pool status" - Check active group pools
• "explain ticket types" - Learn about solo vs pool tickets
• Winnings distributed proportionally to contributions!

🎯 Pool vs Solo Tickets:
• Solo: You keep 100% of winnings
• Pool: Share costs and winnings with group members`
        : `

🎫 Solo Tickets Only:
• Individual purchases with 100% ownership
• Join a group chat for pool purchase options`;

      const smartFeatures = `

🤖 Smart AI Features:
• Natural conversation - "I want to buy some tickets"
• Context awareness - remembers your purchase intent
• Confirmation flow - "Yes" to approve purchases
• Intelligent responses to "7", "buy me a ticket", etc.`;

      const greeting = userAddress
        ? await getPersonalizedGreeting(userAddress)
        : "Hello!";

      return `🎰 LottoBot (@lottobot.base.eth)\n\n${greeting} Jackpot: $${lotteryStats.jackpotPool || "0"}\n\n📝 Commands:\n• "buy 3 solo tickets" → Instant transaction\n• "buy 2 pool tickets" → Join daily pool\n• "5" → Choose solo or pool\n• "stats" → Your history (${lotteryStats.totalTicketsPurchased || 0} tickets)\n• "claim" → Withdraw winnings\n\n🎫 Solo vs Pool Tickets:\n• Solo: "buy 3 solo ticket(s)" - You keep 100% of any winnings\n• Pool: "buy 2 pool ticket(s)" - Join daily pool, winnings shared proportionally\n• Just "buy 3 tickets" → Choose solo or pool\n\n🤖 Automation:\n• "setup spend permission" → Enable automated buying\n• "start automation" → Begin daily purchases\n• "spend status" → Check automation status\n\n${isGroupChat ? "👥 Pool: Combine chances with group" : "🎫 Solo: Keep 100% winnings"}\n\n⚡ Just tell me what you want - I understand natural language\n🌐 Full site: https://frame.megapot.io/?referral=c7m8NL7l`;
    } catch (error) {
      console.error("Error generating contextual help:", error);
      return `🎰 LottoBot (@lottobot.base.eth)

Quick Commands:
• "buy 3 solo tickets" → Instant transaction
• "buy pool tickets" → Join daily pool
• "stats" → Your history
• "claim" → Withdraw winnings

⚡ Natural language supported
🌐 Full site: https://frame.megapot.io/?referral=c7m8NL7l`;
    }
  }
}
