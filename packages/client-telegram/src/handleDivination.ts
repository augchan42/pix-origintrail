import { Context } from "telegraf";
import { IAgentRuntime, elizaLogger, stringToUuid } from "@elizaos/core";
import { DivinationClient } from "./divination";
import { composeContext, generateText, ModelClass } from "@elizaos/core";
import { pixDivinationTemplate } from "./divination";

export async function handleDivinationCommand(
    ctx: Context,
    runtime: IAgentRuntime,
) {
    try {
        await ctx.reply("🔮 Initiating market divination...");

        // Add actor information
        const actors = `# Actors\n@${ctx.from?.username || ctx.from?.id}\nChatDKG`;

        const divinationClient = new DivinationClient();
        const [marketSentiment, newsEvents, oracleReading] = await Promise.all([
            divinationClient.fetchMarketSentiment(),
            divinationClient.fetchIraiNews(5),
            divinationClient.fetch8BitOracle(),
        ]);

        const roomId = stringToUuid(`telegram-divination-${ctx.message?.message_id}`);

        // Compose state with all the divination data
        const state = await runtime.composeState(
            {
                userId: runtime.agentId,
                roomId: roomId,
                agentId: runtime.agentId,
                content: {
                    text: "market divination",
                    action: "DIVINATION",
                },
            },
            {
                actors,  // Add actors to state
                newsEvent: JSON.stringify(newsEvents, null, 2),
                oracleReading: JSON.stringify(oracleReading, null, 2),
                marketSentiment: JSON.stringify(marketSentiment, null, 2),
            },
        );

        const context = composeContext({
            state: state,
            template: pixDivinationTemplate,
        });

        const response = await generateText({
            runtime,
            context,
            modelClass: ModelClass.LARGE,
        });

        // Send the response
        await ctx.reply(response);

        // Persist to DKG
        await ctx.reply("🔄 Starting DKG persistence...");
        try {
            await runtime.processActions(
                {
                    userId: runtime.agentId,
                    agentId: runtime.agentId,
                    roomId: state.roomId,
                    content: {
                        text: response,
                        action: "INSERT_MEMORY_ACTION",
                        type: "divination",
                        metadata: {
                            marketSentiment,
                            newsEvents,
                            oracleReading
                        }
                    }
                },
                [{
                    userId: runtime.agentId,
                    agentId: runtime.agentId,
                    roomId: state.roomId,
                    content: {
                        text: response,
                        action: "INSERT_MEMORY_ACTION"
                    }
                }],
                state,
                async (result) => {
                    await ctx.reply("📥 DKG callback received result: " + JSON.stringify(result));
                    if (result.text) {
                        await ctx.reply("📤 Attempting to send DKG response...");
                        try {
                            await ctx.reply(result.text);
                            await ctx.reply("✅ DKG response sent successfully");
                        } catch (replyError) {
                            await ctx.reply("❌ Failed to send DKG response: " + replyError.message);
                        }
                    }
                    await ctx.reply("✅ DKG callback completed");
                    return [];
                }
            );
            await ctx.reply("✅ DKG persistence completed successfully");
        } catch (error) {
            await ctx.reply("❌ DKG persistence failed: " + error.message);
            throw error;
        }

    } catch (error) {
        elizaLogger.error("Error in divination command:", error);
        await ctx.reply("⚠️ Divination circuits overloaded. Try again later.");
    }
}

function getSentimentEmoji(sentiment: string): string {
    const sentimentMap = {
        bearish: "🔻",
        "very bearish": "📉",
        bullish: "🔺",
        "very bullish": "📈",
        neutral: "➡️",
        unknown: "❓",
    };

    return sentimentMap[sentiment.toLowerCase()] || "❓";
}

