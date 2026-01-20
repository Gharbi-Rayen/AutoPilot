import prisma from "@/lib/db";
import { inngest } from "./client";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { createOpenAI } from '@ai-sdk/openai';

import { createAnthropic } from '@ai-sdk/anthropic';



const anthropic = createAnthropic();
const google =createGoogleGenerativeAI();
const openai = createOpenAI();

export const execute = inngest.createFunction(
  { id: "execute" },
  { event: "execute/ai" },
  async ({ event, step }) => {

   await step.sleep("pretend","5s");

   const {steps : geminiSteps} = await step.ai.wrap("gemini-generate-text", generateText, 
    { 
      system: "You are a helpful assistant that generates text based on user prompts.",
      model: google('gemini-2.5-flash'),
      prompt: "what's 4 + 4",
      experimental_telemetry: {
      isEnabled: true,
      recordInputs: true,
      recordOutputs: true,
      },
    }
   );  



   const {steps : openaiSteps} = await step.ai.wrap("openai-generate-text", generateText, 
    { 
      system: "You are a helpful assistant that generates text based on user prompts.",
      model: openai('gpt-4o'),
      prompt: "what's 4 + 4",
      experimental_telemetry: {
    isEnabled: true,
    recordInputs: true,
    recordOutputs: true,
  },
    }
   );  


   const {steps : anthropicSteps} = await step.ai.wrap("anthropic-generate-text", generateText, 
    { 
      system: "You are a helpful assistant that generates text based on user prompts.",
      model: anthropic('claude-sonnet-4-0'),
      prompt: "what's 4 + 4",
      experimental_telemetry: {
    isEnabled: true,
    recordInputs: true,
    recordOutputs: true,
  },
    }
   );  
   return {
    geminiSteps,
    openaiSteps,
    anthropicSteps
   };
},
);
