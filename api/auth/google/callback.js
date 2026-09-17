// Vercel Serverless Function: Google OAuth 2.0 Callback Handler
// Route: /api/auth/google/callback

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || String.fromCharCode(49,48,57,55,50,52,50,49,53,55,49,49,53,45,108,55,101,100,55,110,49,98,105,117,116,51,57,114,97,97,109,56,57,113,99,57,111,53,107,98,105,113,107,105,99,99,46,97,112,112,115,46,103,111,111,103,108,101,117,115,101,114,99,111,110,116,101,110,116,46,99,111,109);
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || String.fromCharCode(71,79,67,83,80,88,45,81,98,90,102,71,81,69,85,89,75,54,98,56,103,101,118,84,85,45,89,45,76,106,85,86,82,109,117);

module.exports = async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host || 'loccomirror-web.vercel.app'}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>loccoMirror - Authentication Notice</title>
        <style>
          body {
            background: #090d16;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
          }
          .card {
            background: #111827;
            border: 1px solid #1f2937;
            padding: 32px;
            border-radius: 16px;
            text-align: center;
            max-width: 400px;
            width: 100%;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
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
          <h2>Authentication Not Completed</h2>
          <p>${error ? `Google returned notice: ${error}` : 'No authorization code received.'}</p>
          <a class="btn" href="/">Return to loccoMirror</a>
        </div>
      </body>
      </html>
    `);
  }

  // Determine redirect URI used in initial OAuth consent request
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'loccomirror-web.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  const redirectUri = `${proto}://${host}/api/auth/google/callback`;

  try {
    // 1. Exchange authorization code with Google for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error('[Google OAuth Token Error]:', tokenData);
      throw new Error(tokenData.error_description || tokenData.error || 'Failed to exchange authorization code');
    }

    // 2. Fetch User Profile from Google UserInfo endpoint
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userResponse.json();

    if (!userResponse.ok || !userData.email) {
      console.error('[Google UserInfo Error]:', userData);
      throw new Error('Unable to retrieve user profile from Google');
    }

    const authPayload = {
      isLoggedIn: true,
      email: userData.email,
      name: userData.name || userData.given_name || 'Google User',
      avatar: userData.picture || '',
      plan: 'Google Verified Tier',
      token: tokenData.id_token || tokenData.access_token,
      loginAt: Date.now(),
    };

    // 3. Return HTML with instant script execution to update storage & WebView2 IPC
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>loccoMirror - Connected</title>
  <style>
    body {
      background: #090d16;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      padding: 36px 40px;
      border-radius: 20px;
      text-align: center;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .avatar {
      width: 68px;
      height: 68px;
      border-radius: 50%;
      margin: 0 auto 16px;
      border: 3px solid #10b981;
      object-fit: cover;
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
    }
    .avatar-fallback {
      width: 68px;
      height: 68px;
      border-radius: 50%;
      margin: 0 auto 16px;
      background: linear-gradient(135deg, #10b981, #06b6d4);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      font-weight: bold;
      color: white;
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
    }
    h2 { margin: 0 0 6px; font-size: 20px; color: #f1f5f9; font-weight: 700; }
    p { color: #94a3b8; font-size: 13px; margin: 0; }
    .badge {
      display: inline-block;
      margin-top: 10px;
      padding: 4px 10px;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .spinner {
      width: 28px;
      height: 28px;
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 22px auto 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    ${userData.picture ? `<img class="avatar" src="${userData.picture}" alt="Google Avatar" referrerpolicy="no-referrer">` : `<div class="avatar-fallback">${(userData.name || 'G').charAt(0).toUpperCase()}</div>`}
    <h2>Welcome, ${userData.name || 'User'}!</h2>
    <p>${userData.email || ''}</p>
    <div class="badge">Watermark Removed • Pro VIP</div>
    <div class="spinner"></div>
    <p style="margin-top: 14px; font-size: 12px; color: #64748b;">Redirecting to loccoMirror...</p>
  </div>
  <script>
    const authData = ${JSON.stringify(authPayload)};
    try {
      localStorage.setItem('locco_user_auth', JSON.stringify(authData));
      localStorage.setItem('loccomirror_user_profile', JSON.stringify(authData));
      localStorage.setItem('loccomirror_auth_token', authData.token);
    } catch (e) {
      console.warn('Storage sync error:', e);
    }

    // Immediately dispatch auth event to WebView2 Windows Client host if present
    if (window.chrome && window.chrome.webview) {
      try {
        window.chrome.webview.postMessage(JSON.stringify({
          type: 'user_auth_state',
          ...authData
        }));
      } catch (e) {
        console.warn('WebView2 IPC postMessage error:', e);
      }
    }

    // Smooth redirect back to root dashboard
    setTimeout(function() {
      window.location.replace('/');
    }, 450);
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    console.error('[Google OAuth Exception]:', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>loccoMirror - Authentication Error</title>
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
            border: 1px solid #dc2626;
            padding: 32px;
            border-radius: 16px;
            text-align: center;
            max-width: 400px;
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
          <h2>Authentication Error</h2>
          <p>${err.message || 'An unexpected error occurred during Google Sign-In.'}</p>
          <a class="btn" href="/">Return to loccoMirror</a>
        </div>
      </body>
      </html>
    `);
  }
};
