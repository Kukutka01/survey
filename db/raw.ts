import {env} from 'cloudflare:workers';
export function getRawDb(){if(!env.DB)throw new Error('Database unavailable');return env.DB;}
