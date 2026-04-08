const CSV_PARSE_CANCEL_KEY_PREFIX = "csv-parse:cancel:";

export const getCsvParseCancelKey = (jobId: string) => {
  return `${CSV_PARSE_CANCEL_KEY_PREFIX}${jobId}`;
};

export interface CsvParseCancelRedisClient {
  set(
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

export const requestCsvParseCancellation = async (
  redis: CsvParseCancelRedisClient,
  jobId: string,
  ttlSeconds = 300,
) => {
  await redis.set(getCsvParseCancelKey(jobId), "1", "EX", ttlSeconds);
};

export const isCsvParseCancellationRequested = async (
  redis: Pick<CsvParseCancelRedisClient, "get">,
  jobId: string,
) => {
  const flag = await redis.get(getCsvParseCancelKey(jobId));
  return flag === "1";
};

export const clearCsvParseCancellation = async (
  redis: Pick<CsvParseCancelRedisClient, "del">,
  jobId: string,
) => {
  await redis.del(getCsvParseCancelKey(jobId));
};
