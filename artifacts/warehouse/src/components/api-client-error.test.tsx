import { afterEach, describe, expect, it, vi } from "vitest";
import { extractApiError, isApiError } from "@workspace/api-client-react";
import { customFetch } from "../../../../lib/api-client-react/src/custom-fetch";

describe("API error helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("извлекает status и пользовательский текст из JSON error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Название уже занято" }), {
          status: 409,
          statusText: "Conflict",
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const error = await customFetch("/api/clients").catch((cause) => cause);

    expect(isApiError(error)).toBe(true);
    expect(extractApiError(error)).toMatchObject({
      status: 409,
      message: "Название уже занято",
      data: { error: "Название уже занято" },
    });
  });

  it("извлекает пользовательский текст из text error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("  Сервис временно недоступен  ", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const error = await customFetch("/api/clients").catch((cause) => cause);

    expect(extractApiError(error)).toMatchObject({
      status: 503,
      message: "Сервис временно недоступен",
      data: "  Сервис временно недоступен  ",
    });
  });

  it("без error body возвращает безопасное сообщение ошибки", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(null, {
          status: 500,
          statusText: "Internal Server Error",
        }),
      ),
    );

    const error = await customFetch("/api/clients").catch((cause) => cause);

    expect(extractApiError(error)).toEqual({
      status: 500,
      message: "HTTP 500 Internal Server Error",
      data: null,
    });
  });

  it("распознаёт структурно совместимую ошибку из другого bundle", () => {
    const error = {
      name: "ApiError",
      message: "HTTP 409 Conflict: Название уже занято",
      status: 409,
      data: { error: "Название уже занято" },
    };

    expect(isApiError(error)).toBe(true);
    expect(extractApiError(error)?.message).toBe("Название уже занято");
  });

  it("поддерживает JSON payload с полем message", () => {
    const error = {
      name: "ApiError",
      message: "HTTP 422 Unprocessable Content",
      status: 422,
      data: { message: "Проверьте заполненные поля" },
    };

    expect(extractApiError(error)?.message).toBe("Проверьте заполненные поля");
  });

  it("объединяет title и detail из problem details payload", () => {
    const error = {
      name: "ApiError",
      message: "HTTP 400 Bad Request",
      status: 400,
      data: {
        title: "Некорректный запрос",
        detail: "Название не может быть пустым",
      },
    };

    expect(extractApiError(error)?.message).toBe(
      "Некорректный запрос — Название не может быть пустым",
    );
  });

  it("не принимает произвольные ошибки за ApiError", () => {
    expect(extractApiError(new Error("Сбой сети"))).toBeNull();
    expect(
      extractApiError({ status: 409, data: { error: "Конфликт" } }),
    ).toBeNull();
  });
});