import { parseAsInteger, parseAsString } from "nuqs/server";
import { PAGINATION } from "@/config/constants";

export const executionsParams = {
  page: parseAsInteger
    .withDefault(PAGINATION.DEFAULT_PAGE)
    .withOptions({ clearOnDefault: true }),
  pageSize: parseAsInteger
    .withDefault(PAGINATION.DEFAULT_PAGE_SIZE)
    .withOptions({ clearOnDefault: true }),
  search: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
  dateFrom: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
  dateTo: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
  durationMin: parseAsInteger,
  durationMax: parseAsInteger,
};
