// UI asset registry. Not tied to POSITION/RLS/formulas/resolver/reference.
// Keyed by user_id (workspace owner), not branch, because Tereshchenko is a
// super_admin without a branch_id.

export type WorkspaceAssets = {
  headerDesktopWebp: string;
  headerDesktopPng: string;
  headerMobileWebp: string;
  headerMobilePng: string;
  splashDesktopWebp: string;
  splashDesktopPng: string;
  splashMobileWebp: string;
  splashMobilePng: string;
};

// Pavlo Tereshchenko (super_admin)
export const TERESHCHENKO_USER_ID = "cfaade16-8eb7-40df-95f8-a44c7368b60b";

const TERESHCHENKO_ASSETS: WorkspaceAssets = {
  headerDesktopWebp: "/branch-assets/tereshchenko/header_desktop.webp",
  headerDesktopPng: "/branch-assets/tereshchenko/header_desktop.png",
  headerMobileWebp: "/branch-assets/tereshchenko/header_mobile.webp",
  headerMobilePng: "/branch-assets/tereshchenko/header_mobile.png",
  splashDesktopWebp: "/branch-assets/tereshchenko/splash_desktop.webp",
  splashDesktopPng: "/branch-assets/tereshchenko/splash_desktop.png",
  splashMobileWebp: "/branch-assets/tereshchenko/splash_mobile.webp",
  splashMobilePng: "/branch-assets/tereshchenko/splash_mobile.png",
};

export function getWorkspaceAssetsForUser(userId: string | null | undefined): WorkspaceAssets | null {
  if (!userId) return null;
  if (userId === TERESHCHENKO_USER_ID) return TERESHCHENKO_ASSETS;
  return null;
}
