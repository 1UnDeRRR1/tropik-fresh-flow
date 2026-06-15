// Per-user / per-branch personal asset registry.
// Pure presentation — does NOT touch POSITION/RLS/formulas/resolver/reference.
//
// Convention: personal packages live under /public/personal-assets/{key}/
// where `key` is a stable id (user_id for personal packages, branch_id for
// branch packages). No matching by surname, folder name, email or full_name.
//
// A package may ship any subset of:
//   - header_desktop.webp + .png, header_mobile.webp + .png  (chrome header)
//   - splash_desktop.webp + .png, splash_mobile.webp + .png  (boot splash)
//   - profile_bg_desktop.webp + .png, profile_bg_mobile.webp + .png
//     (decorative background for the Профіль tab)
//
// All fields below are optional — callers MUST null-check before rendering and
// fall back to neutral chrome when a slot is absent (no cross-user leakage).

export type PersonalAssets = {
  // Header banner (sticky app chrome). Optional — when absent, AppShell
  // renders neutral chrome instead of another user's header.
  headerDesktopWebp?: string;
  headerDesktopPng?: string;
  headerMobileWebp?: string;
  headerMobilePng?: string;
  // Optional dark-theme variants for the mobile header. When present,
  // AppShell renders the light variant under the light theme and swaps to
  // these under the dark theme. Absent = single image for both themes.
  headerMobileWebpDark?: string;
  headerMobilePngDark?: string;
  headerMobileWidth?: number;
  headerMobileHeight?: number;
  headerDesktopWidth?: number;
  headerDesktopHeight?: number;
  // Splash / loading overlay shown right after auth resolution.
  splashDesktopWebp?: string;
  splashDesktopPng?: string;
  splashMobileWebp?: string;
  splashMobilePng?: string;
  // Decorative art-block background for the Профіль page. Sits below content
  // (z-index 0), no-repeat, pinned to the bottom, contain-sized so nothing
  // is cropped or stretched.
  profileBgDesktopWebp?: string;
  profileBgDesktopPng?: string;
  profileBgMobileWebp?: string;
  profileBgMobilePng?: string;
  // Optional dark-theme variants for the profile background.
  profileBgMobileWebpDark?: string;
  profileBgMobilePngDark?: string;
  profileBgDesktopWebpDark?: string;
  profileBgDesktopPngDark?: string;
};


export type OwnerBannerAssets = {
  calendar: string;
  analytics: string;
  statistics: string;
  settings: string;
  splashMobile: string;
  splashDesktop: string;
};

const TERESHCHENKO_USER_ID = "cfaade16-8eb7-40df-95f8-a44c7368b60b";
const MALEKHIV_USER_ID = "44eddfe6-bd13-43ae-acaf-3afb5941179c";
const LUKACH_USER_ID = "f475e275-458e-4af8-96ea-7e06991cbeb2";
const OWNER_BANNER_BASE = "/owner-assets";

function buildFullPackage(
  folder: string,
  dims: { headerMobile: [number, number]; headerDesktop: [number, number] },
): PersonalAssets {
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
    headerMobileWidth: dims.headerMobile[0],
    headerMobileHeight: dims.headerMobile[1],
    headerDesktopWidth: dims.headerDesktop[0],
    headerDesktopHeight: dims.headerDesktop[1],
  };
}

const OWNER_BANNER_ASSETS: OwnerBannerAssets = {
  calendar: `${OWNER_BANNER_BASE}/banner-calendar-oranges.png`,
  analytics: `${OWNER_BANNER_BASE}/banner-analytics-lemons.png`,
  statistics: `${OWNER_BANNER_BASE}/banner-statistics-grapes.jpeg`,
  settings: `${OWNER_BANNER_BASE}/banner-settings-apples.png`,
  splashMobile: `${OWNER_BANNER_BASE}/splash-bananas-mobile.webp`,
  splashDesktop: `${OWNER_BANNER_BASE}/splash-bananas-mobile.png`,
};

export function getOwnerBannerAssets(): OwnerBannerAssets {
  return OWNER_BANNER_ASSETS;
}

// Per-user personal packages. Key = profile.id / auth user.id.
const USER_ASSETS: Record<string, PersonalAssets> = {
  [TERESHCHENKO_USER_ID]: buildFullPackage(TERESHCHENKO_USER_ID, {
    headerMobile: [1290, 600],
    headerDesktop: [2880, 720],
  }),
  [MALEKHIV_USER_ID]: (() => {
    // Malekhiv: desktop header stays as-is; mobile header replaced with a
    // theme-aware pumpkin-cart photograph (light B&W variant by day, dark
    // moonlit variant by night). Profile background uses a wheat-field
    // photograph (no inscription by day, "Україна не згасне" by night).
    // All four mobile images are 1920x480 (4:1).
    const base = `/personal-assets/${MALEKHIV_USER_ID}`;
    const pkg = buildFullPackage(MALEKHIV_USER_ID, {
      headerMobile: [1920, 480],
      headerDesktop: [2880, 720],
    });
    return {
      ...pkg,
      headerMobileWebp: `${base}/header_mobile_light.webp`,
      headerMobilePng: `${base}/header_mobile_light.png`,
      headerMobileWebpDark: `${base}/header_mobile_dark.webp`,
      headerMobilePngDark: `${base}/header_mobile_dark.png`,
      profileBgMobileWebp: `${base}/profile_bg_mobile_light.webp`,
      profileBgMobilePng: `${base}/profile_bg_mobile_light.png`,
      profileBgMobileWebpDark: `${base}/profile_bg_mobile_dark.webp`,
      profileBgMobilePngDark: `${base}/profile_bg_mobile_dark.png`,
    };
  })(),

  // Лукач: splash + profile background only (no custom header — neutral chrome).
  [LUKACH_USER_ID]: (() => {
    const base = `/personal-assets/${LUKACH_USER_ID}`;
    return {
      splashMobileWebp: `${base}/splash_mobile.webp`,
      splashMobilePng: `${base}/splash_mobile.png`,
      splashDesktopWebp: `${base}/splash_desktop.webp`,
      splashDesktopPng: `${base}/splash_desktop.png`,
      profileBgMobileWebp: `${base}/profile_bg_mobile.webp`,
      profileBgMobilePng: `${base}/profile_bg_mobile.png`,
      profileBgDesktopWebp: `${base}/profile_bg_desktop.webp`,
      profileBgDesktopPng: `${base}/profile_bg_desktop.png`,
    };
  })(),
};

// Per-branch packages. Key = branches.id.
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
