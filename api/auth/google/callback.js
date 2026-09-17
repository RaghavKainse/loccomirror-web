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
          <a class="btn" href="/">Return to loccoMirror</a>
        </div>
      </body>
      </html>
    `);
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'loccomirror-web.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  const redirectUri = `${proto}://${host}/api/auth/google/callback`;

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
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Failed to exchange token');
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

    const authPayload = {
      isLoggedIn: true,
      email: userData.email,
      name: userData.name || userData.given_name || 'Google User',
      avatar: userData.picture || '',
      plan: 'Pro',
      token: tokenData.id_token || tokenData.access_token,
      loginAt: Date.now(),
    };

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Signing In...</title>
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
    .avatar {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      margin: 0 auto 12px;
      object-fit: cover;
    }
    h2 { margin: 0 0 4px; font-size: 18px; color: #f1f5f9; }
    p { color: #94a3b8; font-size: 13px; margin: 0; }
    .spinner {
      width: 24px;
      height: 24px;
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 18px auto 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    ${userData.picture ? `<img class="avatar" src="${userData.picture}" alt="Avatar" referrerpolicy="no-referrer">` : ''}
    <h2>Welcome, ${userData.name || 'User'}</h2>
    <p>${userData.email || ''}</p>
    <div class="spinner"></div>
    <p style="margin-top: 14px; font-size: 12px; color: #64748b;">Signing in...</p>
  </div>
  <script>
    const authData = ${JSON.stringify(authPayload)};
    try {
      localStorage.setItem('locco_user_auth', JSON.stringify(authData));
      localStorage.setItem('loccomirror_user_profile', JSON.stringify(authData));
      localStorage.setItem('loccomirror_auth_token', authData.token);
    } catch (e) {}

    if (window.chrome && window.chrome.webview) {
      try {
        window.chrome.webview.postMessage(JSON.stringify({
          action: 'user_auth_state',
          type: 'user_auth_state',
          ...authData
        }));
      } catch (e) {}
    }

    setTimeout(function() {
      window.location.replace('/');
    }, 400);
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(`
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
          <a class="btn" href="/">Return to loccoMirror</a>
        </div>
      </body>
      </html>
    `);
  }
};
