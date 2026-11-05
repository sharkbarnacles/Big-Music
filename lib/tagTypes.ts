// Shared by server and browser code (no database here).
export const TAG_COLORS = ['teal', 'purple', 'amber', 'rose', 'blue', 'green'] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export type Tag = { id: string; name: string; color: TagColor; count: number };
