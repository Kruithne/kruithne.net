import { SQL } from 'bun';
import * as spooder from 'spooder';

if (process.env.DB_URI_MAIN === undefined)
	spooder.panic('process.env.DB_URI_MAIN not configured');

export const db = new SQL(process.env.DB_URI_MAIN as string);
await spooder.db_schema(db, './db/revisions', { recursive: false });
