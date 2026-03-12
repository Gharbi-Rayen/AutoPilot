// import { checkout, polar, portal } from "@polar-sh/better-auth";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "@/lib/db";
// import { polarClient } from "@/lib/polar";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  trustedOrigins: [
    "http://localhost:3000",
    "https://nonpedigreed-virilocally-candie.ngrok-free.dev", // Allow all ngrok URLs
  ],
  // Polar disabled for testing
  // plugins: [
  //   polar({
  //     client: polarClient,
  //     createCustomerOnSignUp: false,
  //     use: [
  //       checkout({
  //         products: [
  //           {
  //             productId: "714a0a0d-9222-4943-8979-cf6215e79071",
  //             slug: "pro",
  //           },
  //         ],
  //         successUrl: process.env.POLAR_SUCCESS_URL,
  //         authenticatedUsersOnly: true,
  //       }),
  //       portal(),
  //     ],
  //   }),
  // ],
});
