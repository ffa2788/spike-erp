import { redirect } from "next/navigation";
import type { Result } from "@/lib/result";

export function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

export function succeed(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(message)}`);
}

export function finish<T>(path: string, result: Result<T>, success: string, next?: string): never {
  if (!result.ok) fail(path, result.error);
  succeed(next ?? path, success);
}
