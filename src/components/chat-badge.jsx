/* =========================================================
   ChatBadge — merges the old "unread comment dot" + "💬 chat ref count"
   into a single element: one 💬 icon showing the chat-ref count, with a
   small notification-dot overlay only when there are unread comments.
   ========================================================= */
import React from "react";
import "./chat-badge.css";

export function ChatBadge({ count = 0, unread = 0, onClick, title }) {
  if (!count && !unread) return null;
  return (
    <span
      className={"chat-badge" + (unread > 0 ? " has-unread" : "")}
      title={title}
      style={onClick ? { cursor: "pointer" } : undefined}
      onClick={onClick}
    >
      💬{count > 0 ? ` ${count}` : ""}
      {unread > 0 && <span className="chat-badge__dot" aria-label={`${unread} unread`} />}
    </span>
  );
}

export default ChatBadge;
