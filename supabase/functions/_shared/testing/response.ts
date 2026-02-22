import { assertEquals } from "std/assert/assert-equals";

export function assertResponseStatus(response: Response, expectedStatus: number): void {
  assertEquals(response.status, expectedStatus);
}

export async function readJsonBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function assertJsonResponse<T>(
  response: Response,
  expectedStatus: number,
): Promise<T> {
  assertResponseStatus(response, expectedStatus);
  return await readJsonBody<T>(response);
}
