import { Auth0Client } from '@auth0/nextjs-auth0/server';

export const isAuth0Configured = !!(
  process.env.AUTH0_DOMAIN &&
  process.env.AUTH0_SECRET &&
  process.env.AUTH0_CLIENT_ID &&
  process.env.AUTH0_CLIENT_SECRET
);

export const auth0 = isAuth0Configured
  ? new Auth0Client({
      authorizationParameters: {
        audience: process.env.AUTH0_AUDIENCE,
        scope: 'openid profile email',
      },
      signInReturnToPath: '/proyectos',
    })
  : null;
