/**
 * Optional "Connexion via Discord" using the OAuth2 implicit grant, which
 * runs entirely in the browser — no backend or client secret required.
 *
 * To enable it, register a Discord application, add your site URL as an
 * OAuth2 redirect, and expose the client id at build time:
 *
 *   VITE_DISCORD_CLIENT_ID=123456789012345678 npm run dev
 *
 * When no client id is configured the button stays hidden and the game is
 * fully playable with a manual pseudo — Discord login is purely cosmetic
 * (it just pre-fills your name and avatar-based identity).
 */

const AUTH_URL = "https://discord.com/api/oauth2/authorize";
const USER_URL = "https://discord.com/api/users/@me";
const STORAGE_KEY = "frontfritas.discord";

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

function clientId(): string | undefined {
  return (import.meta as any).env?.VITE_DISCORD_CLIENT_ID;
}

function redirectUri(): string {
  // Strip any hash/query so it matches the value registered in Discord.
  return window.location.origin + window.location.pathname;
}

/** Wire up the Discord button. `onLogin` receives the resolved display name. */
export async function initDiscord(onLogin: (name: string) => void) {
  const btn = document.getElementById("discord-btn") as HTMLButtonElement | null;
  const status = document.getElementById("discord-status");
  if (!btn || !status) return;

  const cid = clientId();
  if (!cid) {
    // No app configured — leave the button hidden.
    return;
  }
  btn.classList.remove("hidden");

  // 1) Returning from Discord? The access token is in the URL fragment.
  const token = tokenFromHash();
  if (token) {
    history.replaceState(null, "", redirectUri()); // clean the URL
    try {
      const user = await fetchUser(token);
      const name = displayName(user);
      localStorage.setItem(STORAGE_KEY, name);
      showLogged(btn, status, name);
      onLogin(name);
      return;
    } catch {
      status.textContent = "Échec de la connexion Discord.";
      status.classList.remove("hidden");
    }
  }

  // 2) Already logged in this browser?
  const cached = localStorage.getItem(STORAGE_KEY);
  if (cached) {
    showLogged(btn, status, cached);
    onLogin(cached);
  }

  // 3) Kick off the OAuth redirect on click.
  btn.onclick = () => {
    if (localStorage.getItem(STORAGE_KEY)) {
      localStorage.removeItem(STORAGE_KEY);
      showLoggedOut(btn, status);
      return;
    }
    const params = new URLSearchParams({
      client_id: cid,
      redirect_uri: redirectUri(),
      response_type: "token",
      scope: "identify",
    });
    window.location.href = `${AUTH_URL}?${params.toString()}`;
  };
}

function tokenFromHash(): string | null {
  if (!window.location.hash) return null;
  const p = new URLSearchParams(window.location.hash.slice(1));
  return p.get("access_token");
}

async function fetchUser(token: string): Promise<DiscordUser> {
  const res = await fetch(USER_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("discord user fetch failed");
  return res.json();
}

function displayName(u: DiscordUser): string {
  return (u.global_name || u.username || "Joueur").slice(0, 14);
}

function showLogged(btn: HTMLButtonElement, status: HTMLElement, name: string) {
  btn.querySelector("span")!.textContent = `${name} — Déconnexion`;
  status.textContent = "Connecté via Discord ✓";
  status.classList.remove("hidden");
}

function showLoggedOut(btn: HTMLButtonElement, status: HTMLElement) {
  btn.querySelector("span")!.textContent = "Connexion via Discord";
  status.classList.add("hidden");
}
