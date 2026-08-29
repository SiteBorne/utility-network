/**
 * SUN-1221C — thin re-export of the real `cloudflare:sockets` `connect`,
 * typed by the scoped local ambient declaration in
 * `types/cloudflare-sockets.d.ts` (see that file's own doc comment for
 * why a narrow local declaration is used instead of the full
 * `@cloudflare/workers-types` global reference).
 */
export { connect } from 'cloudflare:sockets';
