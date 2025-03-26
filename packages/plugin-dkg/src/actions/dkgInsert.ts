import dotenv from "dotenv";
dotenv.config();
import {
    IAgentRuntime,
    Memory,
    State,
    elizaLogger,
    ModelClass,
    HandlerCallback,
    ActionExample,
    type Action,
    composeContext,
    generateText,
} from "@elizaos/core";
import { DKG_EXPLORER_LINKS } from "../constants.ts";
import { createDKGMemoryTemplate } from "../templates.ts";
// @ts-ignore
import DKG from "dkg.js";
import { DKGMemorySchema, isDKGMemoryContent } from "../types.ts";

let DkgClient: any = null;

const MAX_RETRIES = 3;

async function generateValidJsonLD(
    runtime: IAgentRuntime,
    context: string,
    attempt: number = 1,
    lastError?: { type: "parse" | "validation"; details: string },
): Promise<any> {
    elizaLogger.info(
        `Attempting to generate valid JSON-LD (attempt ${attempt}/${MAX_RETRIES})`,
        {
            previous_error: lastError || "none",
            attempt_number: attempt,
            max_retries: MAX_RETRIES,
            context_preview: context.substring(0, 1000),
        },
    );

    if (attempt > MAX_RETRIES) {
        const errorMsg = `Failed to generate valid JSON-LD after ${MAX_RETRIES} attempts`;
        elizaLogger.error(errorMsg, { last_error: lastError });
        throw new Error(errorMsg);
    }

    let retryContext = context;
    if (lastError) {
        // Add error context to help guide the model
        retryContext = `Previous attempt failed with ${lastError.type} error: ${lastError.details}\n\nPlease generate a valid JSON-LD document that matches the required schema. Ensure all required fields are present and properly formatted.\n\n${context}`;
    }

    try {
        const result = await generateText({
            runtime,
            context: retryContext,
            modelClass: ModelClass.LARGE,
        });

        elizaLogger.debug("Generated text result", {
            result_length: result.length,
            result_preview: result.substring(0, 1000),
        });

        let parsedJson;
        try {
            // Extract JSON from the response if it's wrapped in markdown
            const jsonMatch =
                result.match(/```json\s*([\s\S]*?)\s*```/) ||
                result.match(/```\s*([\s\S]*?)\s*```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : result;
            parsedJson = JSON.parse(jsonStr);

            elizaLogger.debug("Generated JSON-LD for validation", {
                complete_json: JSON.stringify(parsedJson, null, 2),
                validation_stage: "pre-validation",
            });

            elizaLogger.debug("JSON-LD structure analysis", {
                top_level_fields: Object.keys(parsedJson),
                has_context: !!parsedJson["@context"],
                has_type: !!parsedJson["@type"],
                has_divination_context: !!parsedJson["divination:context"],
                divination_context_fields: parsedJson["divination:context"]
                    ? Object.keys(parsedJson["divination:context"])
                    : [],
                hexagram_data: parsedJson["divination:context"]?.hexagramData
                    ? {
                          complete_hexagram:
                              parsedJson["divination:context"].hexagramData,
                          has_full_data:
                              !!parsedJson["divination:context"].hexagramData
                                  .fullHexagramData,
                          has_line_values:
                              !!parsedJson["divination:context"].hexagramData
                                  .hexagramLineValues,
                          has_interpretation:
                              !!parsedJson["divination:context"].hexagramData
                                  .interpretation,
                      }
                    : "missing",
            });
        } catch (parseError) {
            elizaLogger.warn("Failed to parse JSON", {
                error: parseError.message,
                stack: parseError.stack,
                raw_text: result,
            });

            return generateValidJsonLD(runtime, context, attempt + 1, {
                type: "parse",
                details: parseError.message,
            });
        }

        // Validate against schema
        const isValid = isDKGMemoryContent(parsedJson);
        const validationErrors: string[] = [];

        // Check required top-level fields
        if (!parsedJson["@context"]) validationErrors.push("Missing @context");
        if (!parsedJson["@type"]) validationErrors.push("Missing @type");
        if (!parsedJson["@id"]) validationErrors.push("Missing @id");
        if (!parsedJson.author) validationErrors.push("Missing author");

        // Check divination context if present
        if (parsedJson["divination:context"]) {
            const context = parsedJson["divination:context"];
            elizaLogger.debug("Validating divination context", {
                complete_context: context,
                validation_results: {
                    has_market_sentiment: !!context.marketSentiment,
                    market_sentiment_data: context.marketSentiment,
                    has_news_events: !!context.newsEvents,
                    news_events_data: context.newsEvents,
                    has_hexagram_data: !!context.hexagramData,
                    hexagram_complete_data: context.hexagramData,
                    has_interpretation: !!context.interpretation,
                    interpretation_text: context.interpretation,
                },
            });

            if (!context.marketSentiment)
                validationErrors.push(
                    "Missing marketSentiment in divination:context",
                );
            if (!context.newsEvents)
                validationErrors.push(
                    "Missing newsEvents in divination:context",
                );
            if (!context.hexagramData)
                validationErrors.push(
                    "Missing hexagramData in divination:context",
                );
            if (!context.interpretation)
                validationErrors.push(
                    "Missing interpretation in divination:context",
                );
        }

        if (!isValid || validationErrors.length > 0) {
            elizaLogger.warn("Validation failed", {
                validation_errors: validationErrors,
                schema_validation_passed: isValid,
                complete_json: JSON.stringify(parsedJson, null, 2),
                validation_stage: "failed",
            });

            return generateValidJsonLD(runtime, context, attempt + 1, {
                type: "validation",
                details: validationErrors.join("; "),
            });
        }

        elizaLogger.info("Successfully generated valid JSON-LD", {
            attempt,
            complete_json: JSON.stringify(parsedJson, null, 2),
            validation_stage: "success",
            structure: Object.keys(parsedJson),
            divination_context_complete:
                parsedJson["divination:context"] &&
                parsedJson["divination:context"].marketSentiment &&
                parsedJson["divination:context"].newsEvents &&
                parsedJson["divination:context"].hexagramData &&
                parsedJson["divination:context"].interpretation,
        });

        return parsedJson;
    } catch (error) {
        elizaLogger.error("Error generating JSON-LD", {
            error: error.message,
            stack: error.stack,
            attempt,
        });

        if (attempt < MAX_RETRIES) {
            return generateValidJsonLD(runtime, context, attempt + 1, {
                type: "parse",
                details: error.message,
            });
        }
        throw error;
    }
}

export const dkgInsert: Action = {
    name: "INSERT_MEMORY_ACTION",
    similes: ["NO_ACTION", "NO_RESPONSE", "NO_REACTION", "NONE"],
    validate: async (runtime: IAgentRuntime, _message: Memory) => {
        elizaLogger.info("Validating DKG environment variables");
        const requiredEnvVars = [
            "DKG_ENVIRONMENT",
            "DKG_HOSTNAME",
            "DKG_PORT",
            "DKG_BLOCKCHAIN_NAME",
            "DKG_PUBLIC_KEY",
            "DKG_PRIVATE_KEY",
        ];

        const envVarValues = {};
        const missingVars = requiredEnvVars.filter((varName) => {
            const value = runtime.getSetting(varName);
            envVarValues[varName] = value ? "SET" : "MISSING";
            return !value;
        });

        elizaLogger.info("Environment variable status:", envVarValues);

        if (missingVars.length > 0) {
            elizaLogger.error(
                `Missing required environment variables: ${missingVars.join(", ")}`,
            );
            return false;
        }

        elizaLogger.info("DKG environment validation successful");
        return true;
    },
    description:
        "Create a memory on the OriginTrail Decentralized Knowledge Graph after each message. You should run this action for ALL generic messages EXCEPT when the user asks you about your thoughts on stock, cryptocurrency, token or a financial asset.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback: HandlerCallback,
    ): Promise<boolean> => {
        try {
            elizaLogger.info("Initializing DKG client");
            DkgClient = new DKG({
                environment: runtime.getSetting("DKG_ENVIRONMENT"),
                endpoint: runtime.getSetting("DKG_HOSTNAME"),
                port: runtime.getSetting("DKG_PORT"),
                blockchain: {
                    name: runtime.getSetting("DKG_BLOCKCHAIN_NAME"),
                    publicKey: runtime.getSetting("DKG_PUBLIC_KEY"),
                    privateKey: runtime.getSetting("DKG_PRIVATE_KEY"),
                },
                maxNumberOfRetries: 300,
                frequency: 2,
                contentType: "all",
                nodeApiVersion: "/v1",
            });

            const currentPost = String(state.currentPost);
            elizaLogger.info("Processing current post", {
                post_length: currentPost.length,
                post_preview: currentPost.substring(0, 1000),
            });

            const userRegex = /From:.*\(@(\w+)\)/;
            let match = currentPost.match(userRegex);
            let telegramUser = "";

            if (match && match[1]) {
                telegramUser = match[1];
                elizaLogger.info("Extracted user:", { user: telegramUser });
            } else {
                elizaLogger.warn("No user mention found or invalid input");
            }

            elizaLogger.info("Generating DKG memory context");
            const createDKGMemoryContext = composeContext({
                state,
                template: createDKGMemoryTemplate,
            });

            const memoryKnowledgeGraph = await generateValidJsonLD(
                runtime,
                createDKGMemoryContext,
            );

            if (!memoryKnowledgeGraph) {
                const errorMsg =
                    "Failed to create memory: Could not generate valid JSON-LD structure";
                elizaLogger.error("JSON-LD generation failed", {
                    error: errorMsg,
                    memory_id: message.id,
                });

                // Create error memory but don't log success
                await runtime.messageManager.createMemory({
                    id: message.id,
                    userId: runtime.agentId,
                    agentId: runtime.agentId,
                    roomId: message.roomId,
                    content: {
                        text: errorMsg,
                        error: true,
                    },
                    createdAt: Date.now(),
                });

                callback({
                    text: errorMsg,
                    error: true,
                });
                return false;
            }

            elizaLogger.info("Creating DKG asset");
            const createAssetResult = await DkgClient.asset.create(
                {
                    public: memoryKnowledgeGraph,
                },
                { epochsNum: 12 },
            );

            elizaLogger.info("DKG asset created successfully", {
                ual: createAssetResult.UAL,
            });

            if (createAssetResult.UAL) {
                const explorerLink =
                    DKG_EXPLORER_LINKS[runtime.getSetting("DKG_ENVIRONMENT")];
                callback({
                    text: `Created a new memory!\n\nRead my mind on @origin_trail Decentralized Knowledge Graph ${explorerLink}${createAssetResult.UAL} @${telegramUser}`,
                });
                return true;
            } else {
                elizaLogger.error("Missing UAL in create asset result");
                callback({
                    text: "Failed to create memory: No UAL returned",
                });
                return false;
            }
        } catch (error) {
            const errorMsg =
                error instanceof Error ? error.message : String(error);
            elizaLogger.error("Error in DKG insert action:", {
                error: errorMsg,
                memory_id: message.id,
                stack: error instanceof Error ? error.stack : undefined,
                response_data: error.response?.data
                    ? JSON.stringify(error.response.data, null, 2)
                    : undefined,
            });

            // Create error memory but don't log success
            await runtime.messageManager.createMemory({
                id: message.id,
                userId: runtime.agentId,
                agentId: runtime.agentId,
                roomId: message.roomId,
                content: {
                    text: `Failed to create memory: ${errorMsg}`,
                    error: true,
                },
                createdAt: Date.now(),
            });

            callback({
                text: `Failed to create memory: ${errorMsg}`,
                error: true,
            });
            return false;
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "execute action DKG_INSERT",
                    action: "DKG_INSERT",
                },
            },
            {
                user: "{{user2}}",
                content: { text: "DKG INSERT" },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "add to dkg", action: "DKG_INSERT" },
            },
            {
                user: "{{user2}}",
                content: { text: "DKG INSERT" },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "store in dkg", action: "DKG_INSERT" },
            },
            {
                user: "{{user2}}",
                content: { text: "DKG INSERT" },
            },
        ],
    ] as ActionExample[][],
} as Action;
