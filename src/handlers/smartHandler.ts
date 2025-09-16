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

      // Fetch current lottery data for context
      const lotteryStats = await this.megaPotManager.getStats(userAddress);
      const allTimeStats = await this.fetchAllTimeStats();

      // Create context for the LLM
      const contextPrompt = this.buildContextPrompt(
        lotteryStats,
        allTimeStats,
        isGroupChat,
        conversationContext,
      );

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
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
        "I'm here to help with MegaPot lottery! Try asking about buying tickets, checking stats, or jackpot info.";

      // Parse the LLM response to extract intent and data
      const intent = this.extractIntentFromResponse(
        response,
        message,
        conversationId,
        userInboxId,
      );

      // Update context with the detected intent
      if (conversationId && userInboxId) {
        this.contextHandler.updateLastIntent(
          conversationId,
          userInboxId,
          intent.type,
          intent.confidence,
        );
      }

      return {
        ...intent,
        response: await this.formatResponse(
          response,
          intent.type,
          lotteryStats,
          userAddress,
        ),
      };
    } catch (error) {
      console.error("❌ Error parsing message intent:", error);

      // Fallback to rule-based parsing
      const fallbackIntent = this.fallbackIntentParsing(message);
      return {
        ...fallbackIntent,
        response:
          "I'm having trouble processing your request right now, but I can still help! Try using the action buttons or ask about buying tickets, checking stats, or jackpot info.",
      };
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

    return `You are MegaPot, an AI assistant for a lottery system on Base blockchain. Your role is to:

1. ANALYZE user messages and determine their intent
2. PROVIDE helpful, concise responses (max 2-3 sentences)
3. GUIDE users toward appropriate actions
4. EXTRACT numerical data when users mention ticket quantities

CURRENT LOTTERY DATA:
- Jackpot: $${lotteryStats.jackpotPool || "0"}
- Ticket Price: $${lotteryStats.ticketPrice || "1.00"} USDC
- Tickets Sold: ${lotteryStats.ticketsSoldRound || 0}
- Active Players: ${lotteryStats.activePlayers || 0}
- User's Total Tickets: ${lotteryStats.totalTicketsPurchased || 0}
- User's Spending: ${lotteryStats.totalSpent || "$0"}

ALL-TIME STATS:
- Total Jackpots: $${allTimeStats?.JackpotsRunTotal_USD?.toLocaleString() || "179,816,793"}
- Total Players: ${allTimeStats?.total_players?.toLocaleString() || "14,418"}
- Total Tickets: ${allTimeStats?.total_tickets?.toLocaleString() || "282,495"}
- Total Winners: ${allTimeStats?.total_won || "19"}

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

POOL TICKETS: When user mentions "pool tickets", detect as pooled_purchase intent. Provide very brief response like "Processing pool purchase..." - the main handler will send the detailed confirmation message.

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
    response: string,
    originalMessage: string,
    conversationId?: string,
    userInboxId?: string,
  ): Omit<MessageIntent, "response"> {
    const lowerResponse = response.toLowerCase();
    const lowerMessage = originalMessage.toLowerCase();

    // Check for context-aware confirmation/cancellation first
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
          };
        } else if (isSimpleCancellation) {
          return {
            type: "cancellation",
            confidence: 0.95,
            extractedData: { isCancellation: true },
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

    // Try to extract ticket count from LLM response if not found in original message
    if (!ticketCount && lowerResponse) {
      const llmTicketMatch = lowerResponse.match(/(\d+)\s*tickets?/i);
      if (llmTicketMatch) {
        const llmTicketCount = parseInt(llmTicketMatch[1]);
        if (llmTicketCount >= 1 && llmTicketCount <= 100) {
          ticketCount = llmTicketCount;
        }
      }
    }

    // FIRST: Check for pool purchase detection (higher priority than regular buy)
    const poolKeywords = [
      "pool",
      "group",
      "together",
      "shared",
      "collective",
      "join",
      "participate",
      "with others",
      "with friends",
      "with everyone",
    ];

    const hasPoolContext = poolKeywords.some(
      (keyword) =>
        lowerMessage.includes(keyword) ||
        (lowerMessage.includes("ticket") && lowerMessage.includes(keyword)),
    );

    if (hasPoolContext) {
      return {
        type: "pooled_purchase",
        confidence: 0.9,
        extractedData: {
          pooledRequest: true,
          ticketCount,
          askForPurchaseType:
            !lowerMessage.includes("pool") && !lowerMessage.includes("group"),
        },
      };
    }

    // SECOND: Check for regular buy tickets (after pool check)
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
        extractedData: { ticketCount },
      };
    }

    if (
      lowerMessage.includes("stat") ||
      (lowerMessage.includes("ticket") && lowerMessage.includes("my"))
    ) {
      return { type: "check_stats", confidence: 0.8 };
    }

    if (
      lowerMessage.includes("jackpot") ||
      lowerMessage.includes("prize") ||
      lowerMessage.includes("pot")
    ) {
      return { type: "jackpot_info", confidence: 0.8 };
    }

    if (lowerMessage.includes("claim") || lowerMessage.includes("winning")) {
      return { type: "claim_winnings", confidence: 0.8 };
    }

    if (lowerMessage.includes("help") || lowerMessage.includes("command")) {
      return { type: "help", confidence: 0.9 };
    }

    if (
      lowerMessage.includes("hi") ||
      lowerMessage.includes("hello") ||
      lowerMessage.includes("gm") ||
      lowerMessage.includes("hey") ||
      lowerMessage.includes("whaddup") ||
      lowerMessage.includes("sup")
    ) {
      return { type: "greeting", confidence: 0.9 };
    }

    if (
      lowerMessage.includes("how") ||
      lowerMessage.includes("what") ||
      lowerMessage.includes("?")
    ) {
      return { type: "general_inquiry", confidence: 0.7 };
    }

    // Special case: user claims to be in group chat
    if (
      lowerMessage.includes("group chat") ||
      lowerMessage.includes("this is a group")
    ) {
      return { type: "general_inquiry", confidence: 0.8 };
    }

    // Handle solo/pool choice responses
    if (/^(solo|individual)$/i.test(originalMessage.trim())) {
      return { type: "buy_tickets", confidence: 0.9 };
    }
    if (/^(pool|group)$/i.test(originalMessage.trim())) {
      return { type: "pooled_purchase", confidence: 0.9 };
    }

    return { type: "unknown", confidence: 0.3 };
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
    // Remove truncation - let full responses through
    const baseResponse = response;

    switch (intentType) {
      case "buy_tickets":
        return `${baseResponse}\n\n🎫 Current ticket price: $${lotteryStats.ticketPrice || "1.00"} USDC on Base network.`;

      case "jackpot_info":
        return `${baseResponse}\n\n🎰 Jackpot: $${lotteryStats.jackpotPool || "0"} | Tickets sold: ${lotteryStats.ticketsSoldRound || 0}`;

      case "pooled_purchase":
        return `${baseResponse}\n\n👥 In group chats, members can buy pool tickets together to increase collective winning chances!`;

      case "greeting":
        if (userAddress) {
          const personalizedGreeting =
            await getPersonalizedGreeting(userAddress);
          return `${personalizedGreeting} Welcome to the megapot lottery agent. You can buy tickets, check your stats, or inquire about the jackpot. What would you like to do today?\n\n🌐 Try the full experience: https://frame.megapot.io`;
        }
        return `${baseResponse}\n\n🌐 Try the full experience: https://frame.megapot.io`;

      default:
        return baseResponse;
    }
  }

  /**
   * Fallback intent parsing using rule-based approach
   */
  private fallbackIntentParsing(
    message: string,
  ): Omit<MessageIntent, "response"> {
    const lowerMessage = message.toLowerCase();

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
          ticketCount = this.parseNumberFromText(numberStr);
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
      for (const word of wordNumbers) {
        if (
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
        extractedData: { ticketCount },
      };
    }

    if (lowerMessage.includes("stat") || lowerMessage.includes("my")) {
      return { type: "check_stats", confidence: 0.7 };
    }

    if (lowerMessage.includes("jackpot") || lowerMessage.includes("prize")) {
      return { type: "jackpot_info", confidence: 0.7 };
    }

    if (lowerMessage.includes("help")) {
      return { type: "help", confidence: 0.8 };
    }

    if (
      lowerMessage.includes("gm") ||
      lowerMessage.includes("hello") ||
      lowerMessage.includes("hi") ||
      lowerMessage.includes("whaddup")
    ) {
      return { type: "greeting", confidence: 0.8 };
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
      const ticketCount = this.parseNumberFromText(lowerMessage);
      if (ticketCount) {
        return {
          type: "buy_tickets",
          confidence: 0.9,
          extractedData: { ticketCount },
        };
      }
    }

    return { type: "unknown", confidence: 0.5 };
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

      return `🎰 Smart MegaPot Lottery Assistant

${greeting} Here's your lottery dashboard:

📊 Current Round:
• Jackpot: $${lotteryStats.jackpotPool || "0"}
• Ticket Price: $${lotteryStats.ticketPrice || "1.00"} USDC
• Your Total Tickets: ${lotteryStats.totalTicketsPurchased || 0}
• Solo Tickets: ${lotteryStats.individualTicketsPurchased || 0}
• Pool Tickets: ${lotteryStats.groupTicketsPurchased || 0}

💬 Smart Commands:
• "buy X tickets" - Purchase individual tickets
• "stats" or "my stats" - View your statistics  
• "jackpot" or "prize info" - Current round details
• "claim" or "winnings" - Claim any prizes
• "help" - Show this help message${smartFeatures}${groupInfo}

🏆 All-Time Performance:
• Total Jackpots Won: $${allTimeStats?.JackpotsRunTotal_USD?.toLocaleString() || "179M+"}
• Lucky Winners: ${allTimeStats?.total_won || "19"} players
• Total Tickets Sold: ${allTimeStats?.total_tickets?.toLocaleString() || "282K+"}

⚠️ Requirements:
• USDC on Base network for purchases
• Connected wallet for transactions

🌐 Full experience: https://frame.megapot.io`;
    } catch (error) {
      console.error("Error generating contextual help:", error);
      return `🎰 Smart MegaPot Lottery Assistant

I'm an AI-powered lottery assistant that can help you:
• Buy tickets with natural language
• Check your statistics and history  
• View jackpot information
• Claim winnings
• Understand solo vs pool ticket options

Use the action buttons below or just ask me naturally!`;
    }
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
}
