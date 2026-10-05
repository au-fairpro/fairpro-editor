// Who a SuperDoc comment mentions. Kept apart from the adapter so it can be
// tested without loading SuperDoc.

import type { CommentMentions } from "./bridge";

/**
 * The emails a comment mentions, from a SuperDoc comments update, or null
 * when the update is not a comment being added or changed.
 */
export function commentMentions(update: {
  type: string;
  comment?: Record<string, unknown> | null;
}): CommentMentions | null {
  if (update.type !== "add" && update.type !== "update") return null;
  const comment = update.comment;
  if (!comment) return null;
  const id = comment.commentId ?? comment.id;
  if (typeof id !== "string" || id === "") return null;
  const mentions = Array.isArray(comment.mentions) ? comment.mentions : [];
  const emails = mentions
    .map((mention: unknown) =>
      typeof mention === "object" && mention !== null
        ? (mention as { email?: unknown }).email
        : undefined,
    )
    .filter(
      (email): email is string => typeof email === "string" && email !== "",
    );
  return { commentId: id, emails };
}
