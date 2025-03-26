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

interface DivinationData {
    hexagramNumber: number;
    binary: string;
    unicode: string;
    name: {
        chinese: string;
        pinyin: string;
    };
    trigrams: {
        upper: {
            english: string;
            chinese: string;
            description: string;
            figure: string;
        };
        lower: {
            english: string;
            chinese: string;
            description: string;
            figure: string;
        };
    };
    lines: Array<{
        number: number;
        text: string;
        changed: boolean;
        value: number;
    }>;
    computation: {
        rounds: Array<{
            initialSticks: number;
            finalSticks: number;
            mappedValue: number;
        }>;
        lineValues: number[];
    };
}

function createDivinationJsonLD(params: {
    hexagramData: DivinationData;
    marketSentiment: any;
    newsEvents: any;
    interpretation: string;
    userId: string;
    userIdentifier: string;
}): any {
    const {
        hexagramData,
        marketSentiment,
        newsEvents,
        interpretation,
        userId,
        userIdentifier,
    } = params;

    return {
        "@context": [
            "https://schema.org",
            {
                hexagram: "https://app.8bitoracle.ai/schema/hexagram#",
                divination: "https://app.8bitoracle.ai/schema/divination#",
            },
        ],
        "@type": ["CreativeWork", "divination:Reading"],
        "@id": `urn:hexagram:${hexagramData.hexagramNumber}`,
        name: `${hexagramData.name.pinyin} - ${hexagramData.name.chinese}`,
        dateCreated: new Date().toISOString(),
        author: {
            "@type": "Person",
            "@id": userId,
            identifier: userIdentifier,
        },
        "hexagram:data": {
            "@type": "hexagram:Hexagram",
            "hexagram:number": hexagramData.hexagramNumber,
            "hexagram:binary": hexagramData.binary,
            "hexagram:unicode": hexagramData.unicode,
            "hexagram:name": {
                chinese: hexagramData.name.chinese,
                pinyin: hexagramData.name.pinyin,
            },
            "hexagram:trigrams": {
                upper: {
                    english: hexagramData.trigrams.upper.english,
                    chinese: hexagramData.trigrams.upper.chinese,
                    description: hexagramData.trigrams.upper.description,
                    figure: hexagramData.trigrams.upper.figure,
                },
                lower: {
                    english: hexagramData.trigrams.lower.english,
                    chinese: hexagramData.trigrams.lower.chinese,
                    description: hexagramData.trigrams.lower.description,
                    figure: hexagramData.trigrams.lower.figure,
                },
            },
            "hexagram:lines": hexagramData.lines,
            "hexagram:computation": {
                rounds: hexagramData.computation.rounds,
                lineValues: hexagramData.computation.lineValues,
            },
        },
        "divination:context": {
            marketSentiment: marketSentiment,
            newsEvents: newsEvents,
            interpretation: interpretation,
        },
    };
}

let DkgClient: any = null;

const MAX_RETRIES = 3;

async function generateValidJsonLD(
    runtime: IAgentRuntime,
    state: State,
    attempt: number = 1,
    lastError?: { type: "parse" | "validation"; details: string },
): Promise<any> {
    elizaLogger.info(
        `Attempting to generate valid JSON-LD (attempt ${attempt}/${MAX_RETRIES})`,
        {
            previous_error: lastError || "none",
            attempt_number: attempt,
            max_retries: MAX_RETRIES,
        },
    );

    if (attempt > MAX_RETRIES) {
        const errorMsg = `Failed to generate valid JSON-LD after ${MAX_RETRIES} attempts`;
        elizaLogger.error(errorMsg, { last_error: lastError });
        throw new Error(errorMsg);
    }

    try {
        // Extract required data from state
        const hexagramData = JSON.parse(
            state.oracleReading as string,
        ) as DivinationData;
        const marketSentiment = JSON.parse(state.marketSentiment as string);
        const newsEvents = JSON.parse(state.newsEvent as string);
        const interpretation = (state.interpretation as string) || "";
        const userId = state.userId as string;
        const userIdentifier = (state.userIdentifier as string) || userId;

        // Create JSON-LD using direct object mapping
        const jsonLD = createDivinationJsonLD({
            hexagramData,
            marketSentiment,
            newsEvents,
            interpretation,
            userId,
            userIdentifier,
        });

        elizaLogger.debug("Generated JSON-LD for validation", {
            complete_json: JSON.stringify(jsonLD, null, 2),
            validation_stage: "pre-validation",
        });

        // Validate against schema
        const isValid = isDKGMemoryContent(jsonLD);
        const validationErrors: string[] = [];

        if (!isValid) {
            elizaLogger.warn("Validation failed", {
                validation_errors: validationErrors,
                schema_validation_passed: isValid,
                complete_json: JSON.stringify(jsonLD, null, 2),
                validation_stage: "failed",
            });

            return generateValidJsonLD(runtime, state, attempt + 1, {
                type: "validation",
                details: validationErrors.join("; "),
            });
        }

        elizaLogger.info("Successfully generated valid JSON-LD", {
            attempt,
            complete_json: JSON.stringify(jsonLD, null, 2),
            validation_stage: "success",
        });

        return jsonLD;
    } catch (error) {
        elizaLogger.error("Error generating JSON-LD", {
            error: error.message,
            stack: error.stack,
            attempt,
        });

        if (attempt < MAX_RETRIES) {
            return generateValidJsonLD(runtime, state, attempt + 1, {
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
                state,
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
