import { customAlphabet } from 'nanoid';

/**
 * Ids are generated here, not by the database.
 *
 * Rows have to be able to exist before they are written -- a branch copies rows,
 * an MCP call builds a small graph and commits it in one turn -- and an
 * autoincrement cannot do that. The alphabet avoids look-alike characters
 * because these ids end up in log lines a human reads.
 */
const generate = customAlphabet('0123456789abcdefghjkmnpqrstvwxyz', 16);

export const newId = (): string => generate();

/** Prefixed ids for the handful of rows a person types or says out loud. */
export const newIdFor = (prefix: string): string => `${prefix}_${generate()}`;
