import { useQueryStates } from "nuqs";
import { CredentialsParams } from "../params";

export const useCredentialsParams = () => {
  return useQueryStates(CredentialsParams);
};
