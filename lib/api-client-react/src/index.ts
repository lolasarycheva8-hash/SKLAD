export * from "./generated/api";
export * from "./generated/api.schemas";
export {
  ApiError,
  extractApiError,
  isApiError,
  setBaseUrl,
  setAuthTokenGetter,
} from "./custom-fetch";
export type { ApiErrorDetails, AuthTokenGetter } from "./custom-fetch";
