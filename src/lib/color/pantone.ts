/**
 * PANTONE® LOOKUP — honest by design.
 *
 * Pantone colour codes and their official values are proprietary (licensed
 * through Pantone LLC, e.g. Pantone Connect). This project ships NO Pantone
 * data, and never makes codes up: guessing a code for a pink
 * would look authoritative and be wrong.
 *
 * So by default `pantoneMatch` returns `{ status: "unavailable" }` and the
 * colour picker says no licensed library is installed. If you hold a licence,
 * register a provider with the official data:
 *
 *   registerPantoneProvider({ name: "Pantone Connect (licensed)", verified: true,
 *     nearest: (hex) => ({ code: "…", name: "…", hex: "#…" }) });
 *
 * A provider can also be an approximation (verified: false); the picker then
 * labels every match "unverified approximation", never as an official match.
 */
export type PantoneEntry = { code: string; name?: string; hex: string };
export type PantoneProvider = {
  name: string;
  /** True only for officially licensed Pantone data. */
  verified: boolean;
  nearest: (hex: string) => PantoneEntry | null;
};
export type PantoneResult =
  | { status: "unavailable" }
  | { status: "match"; entry: PantoneEntry; verified: boolean; provider: string }
  | { status: "none"; provider: string };

let provider: PantoneProvider | null = null;

export function registerPantoneProvider(p: PantoneProvider | null) {
  provider = p;
}
export const pantoneProvider = () => provider;

export function pantoneMatch(hex: string): PantoneResult {
  if (!provider) return { status: "unavailable" };
  try {
    const entry = provider.nearest(hex);
    return entry ? { status: "match", entry, verified: provider.verified, provider: provider.name } : { status: "none", provider: provider.name };
  } catch {
    return { status: "none", provider: provider.name };
  }
}
