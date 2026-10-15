import { GameError } from "./game";

export async function hashToken(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export function newToken() {
  return crypto.randomUUID() + crypto.randomUUID();
}
export function errorResponse(error: unknown) {
  if (error instanceof GameError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  console.error(
    "Room API error",
    error instanceof Error ? error.message : "unknown",
  );
  return Response.json(
    { error: "服务暂时不可用，请稍后重试" },
    { status: 500 },
  );
}
export async function requestBody(request: Request) {
  const raw = await request.text();
  if (raw.length > 8192) throw new GameError("提交内容过长", 413);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new GameError("提交格式不正确");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new GameError("提交格式不正确");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new GameError("不允许跨站提交", 403);
  return data as Record<string, unknown>;
}
