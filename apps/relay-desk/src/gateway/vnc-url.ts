/**
 * Ensure noVNC query flags match computer-with-agent lease defaults.
 */
export function withVncViewerParams(vncUrl: string): string {
  try {
    const u = new URL(vncUrl);
    if (!u.searchParams.has("autoconnect")) {
      u.searchParams.set("autoconnect", "1");
    }
    if (!u.searchParams.has("resize")) {
      u.searchParams.set("resize", "scale");
    }
    return u.toString();
  } catch {
    return vncUrl;
  }
}
