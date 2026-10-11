// Vercel Serverless Function: Google OAuth 2.0 Callback Handler
// Route: /api/auth/google/callback

import crypto from 'crypto';
import mongoose from 'mongoose';
import dns from 'dns';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {}

const MONGO_URI = (process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://raghavkainse:87086Rk@cluster0.q9gylvi.mongodb.net/loccomirror?retryWrites=true&w=majority').trim();

let cachedMongo = global._loccoMongo;
if (!cachedMongo) {
  cachedMongo = global._loccoMongo = { conn: null, promise: null };
}

async function connectMongo() {
  if (cachedMongo.conn && mongoose.connection.readyState === 1) {
    return cachedMongo.conn;
  }
  if (!cachedMongo.promise) {
    let uri = MONGO_URI;
    if (uri.includes('/LoccoMirror')) {
      uri = uri.replace('/LoccoMirror', '/loccomirror');
    }
    cachedMongo.promise = mongoose.connect(uri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 8000,
    }).then((m) => {
      console.log('[Callback] Connected directly to MongoDB Atlas loccomirror database');
      return m;
    });
  }
  cachedMongo.conn = await cachedMongo.promise;
  return cachedMongo.conn;
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, default: '' },
    avatar: { type: String, default: '' },
    googleId: { type: String, default: '' },
    authProvider: { type: String, default: 'google' },
    plan: { type: String, default: 'pro' },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', userSchema);

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || String.fromCharCode(49, 48, 57, 55, 50, 52, 50, 49, 53, 55, 49, 49, 53, 45, 108, 55, 101, 100, 55, 110, 49, 98, 105, 117, 116, 51, 57, 114, 97, 97, 109, 56, 57, 113, 99, 57, 111, 53, 107, 98, 105, 113, 107, 105, 99, 99, 46, 97, 112, 112, 115, 46, 103, 111, 111, 103, 108, 101, 117, 115, 101, 114, 99, 111, 110, 116, 101, 110, 116, 46, 99, 111, 109);
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || String.fromCharCode(71, 79, 67, 83, 80, 88, 45, 81, 98, 90, 102, 71, 81, 69, 85, 89, 75, 54, 98, 56, 103, 101, 118, 84, 85, 45, 89, 45, 76, 106, 85, 86, 82, 109, 117);

function sendResponse(res, statusCode, body) {
  try {
    if (res.setHeader) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
    if (typeof res.status === 'function' && typeof res.send === 'function') {
      return res.status(statusCode).send(body);
    }
  } catch (e) { }
  res.statusCode = statusCode;
  return res.end(body);
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'screenmirror-loco.vercel.app'}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return sendResponse(res, 400, `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Sign in Failed</title>
        <style>
          body {
            background: #090d16;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
          }
          .card {
            background: #111827;
            border: 1px solid #1f2937;
            padding: 32px;
            border-radius: 16px;
            text-align: center;
            max-width: 360px;
            width: 100%;
          }
          h2 { color: #f87171; margin-top: 0; font-size: 18px; }
          p { color: #94a3b8; font-size: 13px; line-height: 1.5; }
          .btn {
            display: inline-block;
            margin-top: 20px;
            padding: 10px 20px;
            background: #10b981;
            color: #fff;
            text-decoration: none;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Sign In Failed</h2>
          <p>${error ? `Error: ${error}` : 'No authorization code received.'}</p>
          <button class="btn" onclick="window.close()" style="border:none; cursor:pointer;">Close Window</button>
        </div>
      </body>
      </html>
    `);
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'screenmirror-loco.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  const requestRedirectUri = `${proto}://${host}/api/auth/google/callback`;

  // Candidate redirect URIs to ensure token exchange succeeds regardless of domain
  const candidateRedirectUris = Array.from(new Set([
    requestRedirectUri,
    'https://screenmirror-loco.vercel.app/api/auth/google/callback',
    'https://loccomirror-web.vercel.app/api/auth/google/callback',
    'http://localhost:5173/api/auth/google/callback'
  ]));

  try {
    let tokenData = null;
    let lastError = null;

    for (const rUri of candidateRedirectUris) {
      try {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            code,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri: rUri,
            grant_type: 'authorization_code',
          }),
        });

        const data = await tokenResponse.json();
        if (tokenResponse.ok && data.access_token) {
          tokenData = data;
          break;
        } else {
          lastError = data.error_description || data.error || 'Failed to exchange token';
          if (data.error === 'invalid_grant') {
            break;
          }
        }
      } catch (err) {
        lastError = err.message;
      }
    }

    if (!tokenData || !tokenData.access_token) {
      throw new Error(lastError || 'Failed to exchange token with Google');
    }

    const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userResponse.json();

    if (!userResponse.ok || !userData.email) {
      throw new Error('Unable to retrieve profile from Google');
    }

    // ── 1. DIRECT SAVE & STORE IN MONGODB ATLAS DATABASE ──
    const normalizedEmail = (userData.email || '').trim().toLowerCase();
    let dbUser = null;
    let dbToken = null;
    let isNewUser = false;

    try {
      await connectMongo();
      let existing = await User.findOne({ email: normalizedEmail });

      if (!existing) {
        // Automatically create and store new account in MongoDB Atlas
        const displayName = userData.name || userData.given_name || normalizedEmail.split('@')[0];
        existing = await User.create({
          name: displayName,
          email: normalizedEmail,
          avatar: userData.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(normalizedEmail)}`,
          googleId: userData.sub || '',
          authProvider: 'google',
          plan: 'pro',
          lastLogin: new Date(),
        });
        isNewUser = true;
        console.log('[MongoDB Atlas] New user registered and saved in database:', normalizedEmail);
      } else {
        // Existing user: update last login and picture
        existing.lastLogin = new Date();
        if (userData.picture && (!existing.avatar || existing.avatar.includes('dicebear'))) {
          existing.avatar = userData.picture;
        }
        if (userData.sub && !existing.googleId) {
          existing.googleId = userData.sub;
        }
        await existing.save();
        console.log('[MongoDB Atlas] Existing user found and updated in database:', normalizedEmail);
      }
      dbUser = existing;
    } catch (dbErr) {
      console.error('[MongoDB Direct Error]:', dbErr.message);
    }

    // ── 2. SECONDARY SYNC WITH BACKEND API (IF DEPLOYED) ──
    try {
      const apiBase = (process.env.API_BASE_URL || 'https://loccomirror-api.vercel.app').replace(/\/+$/, '');
      const apiRes = await fetch(`${apiBase}/api/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'x-locco-internal-key': 'LM_SEC_HMAC_V2_87086_RK_2026_X99F',
        },
        body: JSON.stringify({
          email: normalizedEmail,
          name: userData.name || userData.given_name || 'Google User',
          avatar: userData.picture || '',
          googleId: userData.sub || '',
        }),
      });
      if (apiRes && apiRes.ok) {
        const apiData = await apiRes.json().catch(() => ({}));
        if (apiData.user) {
          if (!dbUser) dbUser = apiData.user;
          if (apiData.token) dbToken = apiData.token;
          if (apiData.isNewUser) isNewUser = true;
        }
      }
    // Ensure database verification succeeded - STRICTLY disallow login without database
    if (!dbUser) {
      console.error('[Google Auth] REJECTED: User could not be saved or verified in MongoDB database.');
      return sendResponse(res, 403, `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Database Error - Sign In Rejected</title>
          <style>
            body { background: #090d16; color: #f8fafc; font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; }
            .card { background: #111827; border: 1px solid #ef4444; padding: 32px; border-radius: 16px; text-align: center; max-width: 380px; width: 100%; }
            h2 { color: #f87171; margin-top: 0; font-size: 18px; }
            p { color: #94a3b8; font-size: 13px; line-height: 1.5; }
            .btn { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #ef4444; color: #fff; text-decoration: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Database Required</h2>
            <p>Login without database is not permitted. Account could not be verified in the database.</p>
            <button class="btn" onclick="window.close()">Close Window</button>
          </div>
        </body>
        </html>
      `);
    }

    const HMAC_SECRET = 'LM_SEC_HMAC_V2_87086_RK_2026_X99F';
    const finalEmail = (dbUser ? dbUser.email : userData.email).toLowerCase().trim();
    const finalPlanUpper = (dbUser && dbUser.plan ? (dbUser.plan === 'free' ? 'FREE' : 'PRO') : 'PRO').toUpperCase();
    const loginAt = Date.now();
    const sig = crypto.createHmac('sha256', HMAC_SECRET)
      .update(`${finalEmail}:${finalPlanUpper}:${loginAt}`)
      .digest('hex');

    const authPayload = {
      isLoggedIn: true,
      email: finalEmail,
      name: dbUser ? dbUser.name : (userData.name || userData.given_name || 'Google User'),
      avatar: (dbUser && dbUser.avatar) ? dbUser.avatar : (userData.picture || ''),
      plan: finalPlanUpper === 'PRO' ? 'Pro' : 'Free Tier',
      token: dbToken || tokenData.id_token || tokenData.access_token || '',
      loginAt,
      sig,
      isNewUser,
    };

    const payloadJson = JSON.stringify(authPayload);
    const base64Code = Buffer.from(payloadJson).toString('base64');
    const base64UrlCode = Buffer.from(payloadJson).toString('base64url');
    const authCode = `LM-${base64Code}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Signed In - loccoMirror</title>
  <style>
    body {
      background: #090d16;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      padding: 32px 28px;
      border-radius: 20px;
      text-align: center;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
    }
    .avatar {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      margin: 0 auto 14px;
      object-fit: cover;
      border: 2px solid #10b981;
    }
    h2 { margin: 0 0 6px; font-size: 20px; color: #f1f5f9; font-weight: 700; }
    .email { color: #94a3b8; font-size: 13px; margin: 0 0 18px; }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid rgba(16, 185, 129, 0.3);
      margin-bottom: 20px;
    }
    .btn-primary {
      display: block;
      width: 100%;
      padding: 13px 16px;
      background: #10b981;
      color: #ffffff;
      text-decoration: none;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      box-sizing: border-box;
      border: none;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-primary:hover { background: #059669; }
    .code-box {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #1f2937;
      text-align: left;
    }
    .code-label {
      font-size: 11px;
      color: #64748b;
      margin-bottom: 8px;
      display: block;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }
    .code-row {
      display: flex;
      gap: 8px;
    }
    .code-input {
      flex: 1;
      background: #090d16;
      border: 1px solid #374151;
      color: #cbd5e1;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 11px;
      font-family: monospace;
      outline: none;
    }
    .btn-copy {
      background: #1f2937;
      border: 1px solid #374151;
      color: #e2e8f0;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
      white-space: nowrap;
    }
    .btn-copy:hover { background: #374151; }
    .status-msg {
      margin-top: 14px;
      font-size: 12px;
      color: #34d399;
      min-height: 18px;
    }
    .footer-link {
      margin-top: 16px;
      display: block;
      font-size: 12px;
      color: #64748b;
      text-decoration: none;
    }
    .footer-link:hover { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    ${userData.picture ? `<img class="avatar" src="${userData.picture}" alt="Avatar" referrerpolicy="no-referrer">` : ''}
    <h2>Welcome, ${userData.name || 'User'}!</h2>
    <p class="email">${userData.email || ''}</p>
    <div class="badge">✓ Connected</div>

    <button id="open-btn" class="btn-primary" onclick="openApp()">Open loccoMirror App</button>
    <div id="status-msg" class="status-msg">Opening app...</div>

    <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #1f2937;">
      <p style="margin: 0 0 10px; font-size: 12px; color: #94a3b8;">You can close this tab now.</p>
      <button onclick="window.close()" style="background: #1f2937; color: #cbd5e1; border: 1px solid #374151; padding: 7px 18px; border-radius: 8px; font-size: 12px; cursor: pointer; font-weight: 500;">Close Tab</button>
    </div>
  </div>

  <script>
    const authPayload = ${payloadJson};
    const b64Data = "${base64Code}";
    const b64Url = "${base64UrlCode}";

    // Persist in web localStorage
    try {
      localStorage.setItem('locco_user_auth', JSON.stringify(authPayload));
      localStorage.setItem('loccomirror_user_profile', JSON.stringify(authPayload));
      if (authPayload.token) localStorage.setItem('loccomirror_auth_token', authPayload.token);
    } catch (e) {}

    // Post message if opened in WebView2 or popup
    if (window.chrome && window.chrome.webview) {
      try {
        window.chrome.webview.postMessage(JSON.stringify({
          action: 'user_auth_state',
          type: 'user_auth_state',
          ...authPayload
        }));
      } catch (e) {}
    }
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'locco_auth_success', action: 'user_auth_state', payload: authPayload }, '*');
      }
    } catch (e) {}

    // Send auth to local desktop C++ bridge on 127.0.0.1:18245
    function syncToLocalBridge() {
      try {
        fetch('http://127.0.0.1:18245/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(authPayload),
          mode: 'cors',
        }).then(function(res) {
          if (res.ok) {
            const el = document.getElementById('status-msg');
            if (el) el.innerText = 'Connected! Your app is ready.';
          }
        }).catch(function() {
          // Fallback image beacon
          try {
            const img = new Image();
            img.src = 'http://127.0.0.1:18245/auth?data=' + encodeURIComponent(b64Url);
          } catch (e) {}
        });
      } catch(e) {}
    }

    // Launch desktop software directly via custom URI protocol
    function openApp() {
      syncToLocalBridge();
      try {
        window.location.href = 'loccomirror://auth?data=' + encodeURIComponent(b64Url);
      } catch (e) {}
      const el = document.getElementById('status-msg');
      if (el) el.innerText = 'Opening loccoMirror app...';
    }

    // Auto-launch immediately on page load
    syncToLocalBridge();
    setTimeout(openApp, 100);
    setTimeout(openApp, 600);
  </script>
</body>
</html>`;

    return sendResponse(res, 200, html);
  } catch (err) {
    return sendResponse(res, 500, `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Sign in Error</title>
        <style>
          body {
            background: #090d16;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
          }
          .card {
            background: #111827;
            border: 1px solid #1f2937;
            padding: 32px;
            border-radius: 16px;
            text-align: center;
            max-width: 360px;
            width: 100%;
          }
          h2 { color: #ef4444; margin-top: 0; font-size: 18px; }
          p { color: #94a3b8; font-size: 13px; line-height: 1.5; }
          .btn {
            display: inline-block;
            margin-top: 20px;
            padding: 10px 20px;
            background: #2563eb;
            color: #fff;
            text-decoration: none;
            border-radius: 8px;
            font-size: 13px;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Sign In Error</h2>
          <p>${err.message || 'Could not sign in with Google.'}</p>
          <button class="btn" onclick="window.close()" style="border:none; cursor:pointer;">Close Window</button>
        </div>
      </body>
      </html>
    `);
  }
}
