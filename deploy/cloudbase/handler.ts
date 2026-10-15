import { POST as createRoom } from "../../app/api/rooms/route";
import { GET, POST } from "../../app/api/rooms/[code]/route";
import { errorResponse } from "../../lib/room-http";

type GatewayEvent = {
  path?: string;
  httpMethod?: string;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
};

export async function main(event: GatewayEvent) {
  let response: Response;
  try {
    const headers = new Headers(event.headers);
    // 网关路由必须开启“路径透传”，/api 前缀保持原样。
    const path = event.path || "/";
    const host = headers.get("host");
    if (!host || !/^[a-z0-9.:-]+$/i.test(host)) throw new Error("Missing gateway host");
    const request = new Request(`https://${host}${path.startsWith("/") ? path : "/"}`, {
      method: event.httpMethod || "GET",
      headers,
      ...(!["GET", "HEAD"].includes(event.httpMethod || "GET") ? {
        body: event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : event.body || "",
      } : {}),
    });
    const match = /^\/api\/rooms\/([A-Za-z2-9]{6})$/.exec(path);
    if (path === "/api/rooms" && request.method === "POST") response = await createRoom(request);
    else if (match && ["GET", "POST"].includes(request.method)) {
      const context = { params: Promise.resolve({ code: match[1] }) };
      response = await (request.method === "GET" ? GET : POST)(request, context);
    } else response = Response.json({ error: "没有找到这个接口" }, { status: 404 });
  } catch (error) {
    response = errorResponse(error);
  }
  return {
    statusCode: response.status,
    headers: { ...Object.fromEntries(response.headers), "Cache-Control": "no-store" },
    body: await response.text(),
    isBase64Encoded: false,
  };
}
