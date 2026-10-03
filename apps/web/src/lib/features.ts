/**
 * Checks for vaults shared with other people or apps (OneDrive/SharePoint,
 * Syncthing, network drives): watching the folder for changes made
 * elsewhere, checking a note was not changed on disk before saving it, and
 * listing OneDrive conflict copies. Temporarily off; set to true to turn
 * them back on. (Sync with a WebDAV server does not depend on it.)
 */
export const MULTI_USER_CHECKS = false;
