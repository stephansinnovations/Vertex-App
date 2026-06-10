// Google OAuth (Identity Services) token flow for writing to Google Sheets.
// API keys are read-only; writing requires a user-granted access token with the
// spreadsheets scope. The Client ID is public (safe in frontend env).

const CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

let cached = null; // { token, expiresAt }

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    let s = document.getElementById('gis-client');
    if (s) {
      s.addEventListener('load', () => resolve());
      s.addEventListener('error', reject);
      return;
    }
    s = document.createElement('script');
    s.id = 'gis-client';
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
}

// Returns a Google access token with Sheets write scope, prompting the user to
// sign in / consent the first time. Cached until ~1 min before expiry.
export async function getSheetsAccessToken() {
  if (!CLIENT_ID) {
    throw new Error('VITE_GOOGLE_OAUTH_CLIENT_ID is not set — add it to your env.');
  }
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.token;
  }
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        cached = {
          token: resp.access_token,
          expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
        };
        resolve(resp.access_token);
      },
    });
    client.requestAccessToken();
  });
}

export function isGoogleOAuthConfigured() {
  return !!CLIENT_ID;
}
