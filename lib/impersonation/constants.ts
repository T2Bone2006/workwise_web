/** Cookie: tenant currently being viewed (platform admin only). */
export const VIEW_AS_TENANT_COOKIE = 'ww_view_as_tenant';

/** Cookie: admin's real tenant_id, restored when exiting view-as. */
export const VIEW_AS_ORIGIN_COOKIE = 'ww_view_as_origin';

export const VIEW_AS_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  // Session cookie — cleared on exit / logout
  maxAge: 60 * 60 * 12,
};
