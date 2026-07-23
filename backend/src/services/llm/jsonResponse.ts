/**
 * Claude is occasionally instructed "no markdown fences" and does it anyway;
 * this strips a single ```json ... ``` (or bare ```) wrapper before JSON.parse.
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced?.[1] ?? trimmed;
}
