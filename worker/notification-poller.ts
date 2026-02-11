// Fetch and filter Bluesky notifications for bot mentions.
// Extracts thread root URIs from mention notifications.

export type Notification = {
  readonly uri: string;
  readonly cid: string;
  readonly author: { readonly did: string; readonly handle: string };
  readonly reason: string;
  readonly record: {
    readonly text?: string;
    readonly reply?: {
      readonly root: { readonly uri: string; readonly cid: string };
      readonly parent: { readonly uri: string; readonly cid: string };
    };
  };
  readonly indexedAt: string;
};

export type ListNotificationsResponse = {
  readonly notifications: Notification[];
  readonly cursor?: string;
};

export type MentionTarget = {
  /** AT-URI of the thread root post. */
  readonly rootUri: string;
  /** AT-URI of the mention post (for replying). */
  readonly mentionUri: string;
  /** CID of the mention post (for replying). */
  readonly mentionCid: string;
};

/**
 * Fetch notifications from Bluesky API.
 */
export async function fetchNotifications(
  accessJwt: string,
  service: string,
  cursor?: string
): Promise<{ ok: true; value: ListNotificationsResponse } | { ok: false; error: string }> {
  const params = new URLSearchParams({ limit: '50' });
  if (cursor) params.set('cursor', cursor);

  const res = await fetch(
    `${service}/xrpc/app.bsky.notification.listNotifications?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessJwt}` },
    }
  );

  if (!res.ok) {
    return { ok: false, error: `listNotifications failed: ${res.status}` };
  }

  const data = (await res.json()) as ListNotificationsResponse;
  return { ok: true, value: data };
}

/**
 * Extract thread root URIs from mention notifications.
 * Deduplicates by root URI. Excludes mentions from the bot itself.
 */
export function extractMentionTargets(
  notifications: readonly Notification[],
  botDid: string
): MentionTarget[] {
  const seen = new Set<string>();
  const targets: MentionTarget[] = [];

  for (const notif of notifications) {
    if (notif.reason !== 'mention') continue;
    if (notif.author.did === botDid) continue;

    const rootUri = notif.record.reply?.root.uri ?? notif.uri;

    if (seen.has(rootUri)) continue;
    seen.add(rootUri);

    targets.push({
      rootUri,
      mentionUri: notif.uri,
      mentionCid: notif.cid,
    });
  }

  return targets;
}

/**
 * Update the notification cursor to mark notifications as seen.
 * POST app.bsky.notification.updateSeen
 */
export async function updateSeenNotifications(
  accessJwt: string,
  service: string,
  seenAt: string
): Promise<{ ok: boolean }> {
  const res = await fetch(`${service}/xrpc/app.bsky.notification.updateSeen`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ seenAt }),
  });

  return { ok: res.ok };
}
