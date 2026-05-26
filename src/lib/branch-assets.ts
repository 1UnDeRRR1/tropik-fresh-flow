// Per-user / per-branch personal asset registry.
// Pure presentation — does NOT touch POSITION/RLS/formulas/resolver/reference.
//
// Convention: every personal package ships the same 8 files under
//   /public/personal-assets/{key}/
//     header_desktop.webp + .png
//     header_mobile.webp  + .png
//     splash_desktop.webp + .png
//     splash_mobile.webp  + .png
//
// `key` is a stable id — user_id for personal packages, branch_id for branch
// packages. No matching by surname, folder name, email or full_name.
//
// If a user / branch has no personal package, getPersonalAssets() returns null
// and the UI must fall back to neutral chrome (no Tereshchenko leakage).

export type PersonalAssets = {
  headerDesktopWebp: string;
  headerDesktopPng: string;
  headerMobileWebp: string;
  headerMobilePng: string;
  splashDesktopWebp: string;
  splashDesktopPng: string;
  splashMobileWebp: string;
  splashMobilePng: string;
};

const TERESHCHENKO_USER_ID = "cfaade16-8eb7-40df-95f8-a44c7368b60b";

function buildAssets(folder: string): PersonalAssets {
  const base = `/personal-assets/${folder}`;
  return {
    headerDesktopWebp: `${base}/header_desktop.webp`,
    headerDesktopPng: `${base}/header_desktop.png`,
    headerMobileWebp: `${base}/header_mobile.webp`,
    headerMobilePng: `${base}/header_mobile.png`,
    splashDesktopWebp: `${base}/splash_desktop.webp`,
    splashDesktopPng: `${base}/splash_desktop.png`,
    splashMobileWebp: `${base}/splash_mobile.webp`,
    splashMobilePng: `${base}/splash_mobile.png`,
  };
}

// Per-user personal packages. Key = profile.id / auth user.id.
const USER_ASSETS: Record<string, PersonalAssets> = {
  [TERESHCHENKO_USER_ID]: buildAssets(TERESHCHENKO_USER_ID),
};

// Per-branch packages. Key = branches.id. Empty for now — same structure,
// drop a folder under /personal-assets/{branch_id}/ and add an entry here.
const BRANCH_ASSETS: Record<string, PersonalAssets> = {};

/**
 * Resolve the personal asset package for the current user.
 * User-level package wins over branch-level. Returns null when neither
 * exists — callers MUST render neutral chrome in that case (no defaults).
 */
export function getPersonalAssets(
  userId: string | null | undefined,
  branchId?: string | null | undefined,
): PersonalAssets | null {
  if (userId && USER_ASSETS[userId]) return USER_ASSETS[userId];
  if (branchId && BRANCH_ASSETS[branchId]) return BRANCH_ASSETS[branchId];
  return null;
}
