// SDK для проектов Quorvox_team: «Войти через Quorvox ID» на стороне сервера сайта.
// Зависимость: jose (npm i jose). Работает с любым фреймворком — нужен только объект сессии.
//
//   const qid = quorvoxId({ issuer, clientId, clientSecret, redirectUri });
//   // GET /auth/quorvox
//   res.redirect(await qid.loginUrl(session));
//   // GET /auth/quorvox/callback
//   const user = await qid.handleCallback(req.query, session);   // { sub, name, email, email_verified }
import crypto from 'node:crypto';
import * as jose from 'jose';

const b64 = (buf) => Buffer.from(buf).toString('base64url');

export function quorvoxId({ issuer, clientId, clientSecret, redirectUri, scope = 'openid profile email' }) {
  issuer = issuer.replace(/\/$/, '');
  let meta, jwks;
  const discover = async () => {
    if (!meta) {
      const r = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('Quorvox ID недоступен');
      meta = await r.json();
      jwks = jose.createRemoteJWKSet(new URL(meta.jwks_uri));
    }
    return meta;
  };

  return {
    // session — любой изменяемый объект, который сохранится до возврата пользователя
    async loginUrl(session) {
      const m = await discover();
      const state = b64(crypto.randomBytes(16)), nonce = b64(crypto.randomBytes(16)), verifier = b64(crypto.randomBytes(32));
      session.qid = { state, nonce, verifier, t: Date.now() };
      const u = new URL(m.authorization_endpoint);
      u.search = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope,
        state, nonce, code_challenge: b64(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      }).toString();
      return u.toString();
    },

    async handleCallback(query, session) {
      const m = await discover();
      const s = session.qid;
      delete session.qid; // одноразово
      if (query.error) throw new Error(`Quorvox ID: ${query.error_description || query.error}`);
      if (!s || Date.now() - s.t > 10 * 60_000) throw new Error('Вход устарел, начни заново');
      if (!query.state || query.state !== s.state) throw new Error('Неверный state');
      const r = await fetch(m.token_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64'),
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: query.code, redirect_uri: redirectUri, code_verifier: s.verifier }),
        signal: AbortSignal.timeout(8000),
      });
      const tok = await r.json();
      if (!r.ok) throw new Error(`Quorvox ID: ${tok.error_description || tok.error}`);
      const { payload } = await jose.jwtVerify(tok.id_token, jwks, { issuer: m.issuer, audience: clientId });
      if (payload.nonce !== s.nonce) throw new Error('Неверный nonce');
      return { sub: payload.sub, quorvox_id: payload.quorvox_id, name: payload.name, email: payload.email, email_verified: payload.email_verified, amr: payload.amr };
    },
  };
}
