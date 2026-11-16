// Lets Node load the app's TypeScript as it is: '@/...' is src/..., imports without an extension get .ts, and the
// phone-only image module is a stub.
// Use: node --import ./tests/alias.mjs --test tests/outline.test.mjs
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  const src = ${JSON.stringify(new URL('../src/', import.meta.url).href)};
  const stub = ${JSON.stringify(new URL('./stubs/', import.meta.url).href)};
  const tryExt = async (base, ctx, next) => {
    for (const ext of ['.ts', '.tsx', '']) { try { return await next(base + ext, ctx); } catch {} }
    return next(base, ctx);
  };
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) return tryExt(src + spec.slice(2), ctx, next);
    if (spec.startsWith('.') && !/\\.[cm]?[jt]sx?$/.test(spec) && ctx.parentURL?.endsWith('.ts')) return tryExt(new URL(spec, ctx.parentURL).href, ctx, next);
    if (spec === 'expo-image-manipulator') return next(stub + 'expo-image-manipulator.mjs', ctx);
    return next(spec, ctx);
  }
`));
