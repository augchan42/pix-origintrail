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

function extractActor(text) {
    const lines = text.split("\n").filter((line) => line.trim() !== "");
    const actors = lines.slice(1);

    return actors.find((actor) => actor.trim() !== "ChatDKG") || null;
}

export const dkgInsert: Action = {
    name: "INSERT_MEMORY_ACTION",
    similes: ["DKG_INSERT", "NO_ACTION", "NO_RESPONSE", "NO_REACTION", "NONE"], // we want to always run this action
    validate: async (runtime: IAgentRuntime, _message: Memory) => {
        const requiredEnvVars = [
            "DKG_ENVIRONMENT",
            "DKG_HOSTNAME",
            "DKG_PORT",
            "DKG_BLOCKCHAIN_NAME",
            "DKG_PUBLIC_KEY",
            "DKG_PRIVATE_KEY",
        ];

        const missingVars = requiredEnvVars.filter(
            (varName) => !runtime.getSetting(varName),
        );

        if (missingVars.length > 0) {
            elizaLogger.error(
                `Missing required environment variables: ${missingVars.join(", ")}`,
            );
            return false;
        }

        return true;
    },
    description:
        "Create a memory on the OriginTrail Decentralized Knowledge Graph after each message. You should run this action for ALL generic messages EXCEPT when the user asks you about your thoughts on stock, cryptocurrency, token or a financial asset.",
    handler: async (
        runtime: IAgentRuntime,
        _message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback: HandlerCallback,
    ): Promise<boolean> => {
        try {
            DkgClient = new DKG({
                environment: runtime.getSetting("DKG_ENVIRONMENT"),
                endpoint: runtime.getSetting("DKG_HOSTNAME"),
                port: runtime.getSetting("DKG_PORT"),
                blockchain: {
                    name: runtime.getSetting("DKG_BLOCKCHAIN_NAME"),
                    publicKey: runtime.getSetting("DKG_PUBLIC_KEY"),
                    privateKey: runtime.getSetting("DKG_PRIVATE_KEY"),
                },
            });

            const telegramUser = extractActor(state.actors);

            const currentPost = String(state.currentPost);
            elizaLogger.log(`currentPost: ${currentPost}`);

            const createDKGMemoryContext = composeContext({
                state,
                template: createDKGMemoryTemplate,
            });

            const memoryKnowledgeGraphText = await generateText({
                runtime,
                context: createDKGMemoryContext,
                modelClass: ModelClass.LARGE,
            });

            const jsonMatch = memoryKnowledgeGraphText.match(/\{[\s\S]*\}/);

            let memoryKnowledgeGraph = null;
            if (jsonMatch) {
                try {
                    memoryKnowledgeGraph = JSON.parse(jsonMatch[0].trim());
                    elizaLogger.log(
                        "Parsed Memory Knowledge Graph:\n",
                        memoryKnowledgeGraph,
                    );
                } catch (error) {
                    elizaLogger.error("Failed to parse JSON-LD:", error);
                }
            } else {
                elizaLogger.error("No valid JSON-LD object found in the response.");
            }

            // Create asset with 30 second timeout
            let createAssetResult;
            try {
                const assetPromise = DkgClient.asset.create(
                    {
                        public: memoryKnowledgeGraph,
                    },
                    { epochsNum: 12 },
                );

                createAssetResult = await Promise.race([
                    assetPromise,
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("DKG asset creation timed out after 99s")), 99000)
                    )
                ]);
            } catch (error) {
                callback({
                    text: `Failed to create DKG asset: ${error.message}`,
                });
                return false;
            }

            if (!createAssetResult || !createAssetResult.UAL) {
                callback({
                    text: "Failed to get UAL from DKG response",
                });
                return false;
            }

            callback({
                text: `Created a new memory!\n\nRead my mind on @origin_trail Decentralized Knowledge Graph ${DKG_EXPLORER_LINKS[runtime.getSetting("DKG_ENVIRONMENT")]}${createAssetResult.UAL} @${telegramUser}`,
            });

            return true;
        } catch (error) {
            callback({
                text: `DKG initialization failed: ${error.message}`,
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
