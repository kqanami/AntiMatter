// This public Devnet mint is already deployed; a local override supports a replacement test mint.
export const DEVNET_AMT_MINT='GTYjjjnW9hcLg1UrgfZBfpL4BXP74eJcZ9TWDeguL9MR';
export const TOKEN_MINT=(import.meta.env?.VITE_AMT_MINT || (typeof process === 'undefined' ? '' : process.env.VITE_AMT_MINT) || DEVNET_AMT_MINT).trim();
export const TOKEN_SYMBOL='AMT';
export const TOKEN_DECIMALS=9;
