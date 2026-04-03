import type { Realtime } from "@inngest/realtime";
import { useInngestSubscription } from "@inngest/realtime/hooks";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import type { NodeStatus } from "@/components/react-flow/node-status-indicator";
import {
  executionStartedAtAtom,
  nodeStatusMapAtom,
} from "@/store/execution-status";

interface UseNodeStatusOptions {
  nodeId: string;
  channel: string;
  topic: string;
  refreshToken: () => Promise<Realtime.Subscribe.Token>;
}

export function useNodeStatus({
  nodeId,
  channel,
  topic,
  refreshToken,
}: UseNodeStatusOptions) {
  const [status, setStatus] = useState<NodeStatus>("initial");
  const executionStartedAt = useAtomValue(executionStartedAtAtom);
  const setNodeStatusMap = useSetAtom(nodeStatusMapAtom);

  const { data } = useInngestSubscription({
    refreshToken,
    enabled: true,
  });

  useEffect(() => {
    if (executionStartedAt) {
      setStatus("initial");
    }
  }, [executionStartedAt]);

  useEffect(() => {
    if (!data?.length) {
      return;
    }

    //find the latest message for the given nodeId
    const latestMessage = data
      .filter(
        (msg) =>
          msg.kind === "data" &&
          msg.channel === channel &&
          msg.topic === topic &&
          msg.data.nodeId === nodeId &&
          (!executionStartedAt ||
            new Date(msg.createdAt).getTime() >= executionStartedAt),
      )
      .sort((a, b) => {
        if (a.kind === "data" && b.kind === "data") {
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        }
        return 0;
      })[0];

    if (latestMessage?.kind === "data") {
      setStatus(latestMessage.data.status as NodeStatus);
    }
  }, [data, nodeId, channel, topic, executionStartedAt]);

  useEffect(() => {
    setNodeStatusMap((previousMap) => {
      if (previousMap[nodeId] === status) {
        return previousMap;
      }

      return {
        ...previousMap,
        [nodeId]: status,
      };
    });
  }, [nodeId, status, setNodeStatusMap]);

  useEffect(() => {
    return () => {
      setNodeStatusMap((previousMap) => {
        if (!(nodeId in previousMap)) {
          return previousMap;
        }

        const nextMap = { ...previousMap };
        delete nextMap[nodeId];
        return nextMap;
      });
    };
  }, [nodeId, setNodeStatusMap]);

  return status;
}
