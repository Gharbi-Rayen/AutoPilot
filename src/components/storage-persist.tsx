"use client";

import { useEffect } from "react";

export const StoragePersist = () => {
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      void navigator.storage.persist();
    }
  }, []);

  return null;
};
