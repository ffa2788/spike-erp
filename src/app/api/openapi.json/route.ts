import { openApi } from "@/lib/spike-openapi";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(openApi);
}
