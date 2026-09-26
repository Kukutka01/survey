import {NextRequest,NextResponse} from 'next/server';
export function middleware(request:NextRequest){
 const nonce=btoa(crypto.randomUUID());const dev=process.env.NODE_ENV!=='production';
 const csp=["default-src 'self'",`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev?" 'unsafe-eval'":''}`,"style-src 'self' 'unsafe-inline'","img-src 'self' data:","font-src 'self'",`connect-src 'self'${dev?' ws:':''}`,"object-src 'none'","base-uri 'none'","frame-ancestors 'none'","form-action 'self'"].join('; ');
 const headers=new Headers(request.headers);headers.set('Content-Security-Policy',csp);headers.set('x-nonce',nonce);
 const response=NextResponse.next({request:{headers}});response.headers.set('Content-Security-Policy',csp);response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Frame-Options','DENY');response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=()');response.headers.set('Cache-Control','no-store');response.headers.set('Cross-Origin-Resource-Policy','same-origin');if(!['localhost','127.0.0.1'].includes(request.nextUrl.hostname))response.headers.set('Strict-Transport-Security','max-age=31536000');return response;
}
export const config={matcher:['/','/api/:path*']};
