import { SignJWT, jwtVerify } from "jose";

export type TokenPayload = {
  id: string;
  email: string;
  name: string;
  role: string;
  purpose?: string;
};

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET is missing. Set a long random value before starting SPIKE.");
  }
  return new TextEncoder().encode(secret);
}

export async function signToken(payload: TokenPayload, expires: string): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.id)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(key());
}

export async function readToken(token: string | undefined | null): Promise<TokenPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return {
      id: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : "",
      role: typeof payload.role === "string" ? payload.role : "",
      purpose: typeof payload.purpose === "string" ? payload.purpose : undefined,
    };
  } catch {
    return null;
  }
}
