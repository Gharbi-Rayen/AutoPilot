// import { polarClient } from "@polar-sh/better-auth";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // Polar disabled for testing
  // plugins: [polarClient()],
});
