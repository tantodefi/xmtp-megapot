import OpenAI from "openai";
import { MegaPotManager } from "../managers/MegaPotManager.js";

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
    | "unknown";
  confidence: number;
  extractedData?: {
    ticketCount?: number;
    amount?: number;
    pooledRequest?: boolean;
    askForQuantity?: boolean;
  };
  response: string;
}

export class SmartHandler {
  private openai: OpenAI;
  private megaPotManager: MegaPotManager;

  constructor(openaiApiKey: string, megaPotManager: MegaPotManager) {
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.megaPotManager = megaPotManager;
  }

  /**
   * Parse user message using LLM and determine intent with contextual response
   */
  async parseMessageIntent(
    message: string,
    userAddress?: string,
    isGroupChat: boolean = false,
  ): Promise<MessageIntent> {
    try {
      // Fetch current lottery data for context
      const lotteryStats = await this.megaPotManager.getStats(userAddress);
      const allTimeStats = await this.fetchAllTimeStats();

      // Create context for the LLM
      const contextPrompt = this.buildContextPrompt(
        lotteryStats,
        allTimeStats,
        isGroupChat,
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
      const intent = this.extractIntentFromResponse(response, message);

      return {
        ...intent,
        response: this.formatResponse(response, intent.type, lotteryStats),
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
  ): string {
    const groupChatInfo = isGroupChat
      ? "\n- This is a GROUP CHAT. Users can organize POOLED TICKET PURCHASES where multiple people contribute to buy tickets together."
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
- For pooled purchases in groups, explain how multiple people can contribute
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
- unknown: Unclear intent

IMPORTANT: For buy_tickets intent, you MUST extract or infer the ticket quantity:
- "buy me a ticket" = 1 ticket
- "buy tickets" = ask how many
- "buy 5 tickets" = 5 tickets
- Just "7" in ticket context = 7 tickets

Respond naturally but concisely, and I'll handle the specific actions.`;
  }

  /**
   * Extract intent from LLM response
   */
  private extractIntentFromResponse(
    response: string,
    originalMessage: string,
  ): Omit<MessageIntent, "response"> {
    const lowerResponse = response.toLowerCase();
    const lowerMessage = originalMessage.toLowerCase();

    // Enhanced ticket number extraction - more comprehensive patterns
    const ticketPatterns = [
      /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)\s*tickets?/i,
      /(give\s+me|get\s+me|want)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*tickets?/i,
      /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*tickets?/i,
      /tickets?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i,
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
    ];

    let isBuyIntent = false;
    for (const pattern of buyPatterns) {
      if (pattern.test(originalMessage)) {
        isBuyIntent = true;
        break;
      }
    }

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

    // Determine intent based on enhanced patterns
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
      lowerMessage.includes("pool") ||
      lowerMessage.includes("group") ||
      lowerMessage.includes("together")
    ) {
      return {
        type: "pooled_purchase",
        confidence: 0.8,
        extractedData: { pooledRequest: true, ticketCount },
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

    return { type: "unknown", confidence: 0.3 };
  }

  /**
   * Format response based on intent type
   */
  private formatResponse(
    response: string,
    intentType: string,
    lotteryStats: any,
  ): string {
    // Remove truncation - let full responses through
    const baseResponse = response;

    switch (intentType) {
      case "buy_tickets":
        return `${baseResponse}\n\n🎫 Current ticket price: $${lotteryStats.ticketPrice || "1.00"} USDC on Base network.`;

      case "jackpot_info":
        return `${baseResponse}\n\n🎰 Jackpot: $${lotteryStats.jackpotPool || "0"} | Tickets sold: ${lotteryStats.ticketsSoldRound || 0}`;

      case "pooled_purchase":
        return `${baseResponse}\n\n👥 In group chats, multiple members can contribute to buy tickets together!`;

      case "greeting":
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
        extractedData: { askForQuantity: true },
      };
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
        ? "\n\n👥 Group Chat Features:\n• Organize pooled ticket purchases with friends\n• Split costs and share potential winnings"
        : "";

      return `🎰 MegaPot Lottery Assistant

Current Round:
• Jackpot: $${lotteryStats.jackpotPool || "0"}
• Ticket Price: $${lotteryStats.ticketPrice || "1.00"} USDC
• Your Tickets: ${lotteryStats.totalTicketsPurchased || 0}

Commands:
• "buy X tickets" - Purchase lottery tickets
• "stats" - View your statistics  
• "jackpot" - Current round info
• "claim" - Claim winnings

All-Time Stats:
• Total Jackpots: $${allTimeStats?.JackpotsRunTotal_USD?.toLocaleString() || "179M+"}
• Winners: ${allTimeStats?.total_won || "19"} lucky players!

${groupInfo}

🌐 Full experience: https://frame.megapot.io`;
    } catch (error) {
      console.error("Error generating contextual help:", error);
      return "🎰 MegaPot Lottery Assistant - I can help you buy tickets, check stats, view jackpot info, and claim winnings!";
    }
  }
}
